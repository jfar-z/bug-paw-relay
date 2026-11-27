import { productVersion } from "../shared/product-version.js";
import { metricsCapability, trafficWindow } from "../shared/environment-metrics.js";
import { boardCapability } from "../shared/session-boards.js";
import { SessionBoards } from "./session-boards.js";
import { commandPeer, manualSend, manualSendSchema } from "./slash-commands.js";
import { commandChange, commandEntry, commandScope, fixedCommands } from "../shared/slash-commands.js";
import { claudeSdkCapability, claudeSdkStatus } from "../shared/claude-sdk-install.js";
import {
  modelConfigCapability,
  modelOperation,
  modelSelection,
  modelDraft,
  modelResults,
} from "../shared/environment-model-config.js";
import { negotiateLocale } from "../shared/i18n.js";
import { errorBody, localizeError } from "../shared/i18n-errors.js";
import { message as i18nMessage, translate } from "../shared/i18n.js";
import { connectorStorageDetails } from "../shared/connector-storage-errors.js";
import {
  ConnectionDiagnostics,
  closeCategory,
} from "../shared/connection-diagnostics.js";
import { ConnectorUpdates } from "./connector-updates.js";
import { cliRuntimeSchema } from "../shared/contracts.js";
import { runtimeCatalogSchema } from "../shared/runtime-options.js";
import { ReleaseDownloads } from "./release-downloads.js";
import type { WebSocket } from "ws";
import {
  nodeAuthVersion,
  nodeProofText,
  registrationDigest,
  registrationSchema,
  nonceSchema,
} from "../shared/node-identity.js";
import { mentionItemSchema, mentionRank, type MentionItem } from "../shared/mentions.js";
import { LightApps, hostDomain, type LightConfig } from "./light-apps.js";
import { Artifacts } from "./artifacts.js";
import { FilePushTransfers } from "./file-push.js";
import { BoardUploads } from "./board-uploads.js";
import {
  uploadEntriesSchema,
  attachmentsSchema,
  uploadCapability,
} from "../shared/uploads.js";
import { FileTransfers } from "./file-transfers.js";
import { classifyFileLink } from "../shared/files.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import websocket from "@fastify/websocket";
import { terminalAction } from "../shared/claude-terminal.js";
import rateLimit from "@fastify/rate-limit";
import staticFiles from "@fastify/static";
import { randomUUID, verify } from "node:crypto";
import {
  createReadStream,
  existsSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { z } from "zod";
import * as OTPAuth from "otpauth";
import { Store } from "./store.js";
import {
  Vault,
  token,
  digest,
  passwordHash,
  passwordMatches,
  totp,
} from "./security.js";
import { readConnectorRelease, renderInstaller } from "./connector-release.js";
import { Service } from "./service.js";
import { compareSessionActivity } from "../shared/session-order.js";
import { Workbench } from "./workbench.js";
import { RpcPeer } from "../shared/rpc.js";
import {
  AppError,
  idSchema,
  ensure,
  protocolVersion,
  connectorVersionSchema,
} from "../shared/contracts.js";
export interface AppOptions {
  dataDir: string;
  publicUrl: string;
  webDir?: string;
  secureCookie?: boolean;
  light?: LightConfig;
}
/** 同源 HTTP 与环境 WSS 入口；日志不包含请求正文、会话或凭据。 */
export async function createApp(options: AppOptions) {
  const store = new Store(join(options.dataDir, "relay.db"));
  const vault = new Vault(options.dataDir);
  const service = new Service(
    store,
    vault,
    readConnectorRelease(options.webDir),
  );
  const workbench = new Workbench(service);
  const downloads = new ReleaseDownloads(store, vault);
  const files = new FileTransfers();
  const lightConfig = options.light || {
    domain: process.env.RELAY_LIGHT_DOMAIN || "",
    hostUrl: process.env.RELAY_LIGHT_INTERNAL_URL || "",
    key: process.env.RELAY_LIGHT_KEY || "",
  };
  const domain = hostDomain(lightConfig.domain, options.publicUrl);
  const light = new LightApps(service, files, { ...lightConfig, domain, mainOrigin: new URL(options.publicUrl).origin });
  const lightSource = domain ? " https://" + domain : "";
  const uploads = new FilePushTransfers();
  const boardUploads = new BoardUploads(service, uploads, vault);
  const sessionBoards = new SessionBoards(service, files, uploads, boardUploads);
  const connectorUpdates = new ConnectorUpdates(
    service,
    options.webDir,
    (id) =>
      files.busyFor(service.peers.get(id)) ||
      uploads.busyFor(service.peers.get(id)),
  );
  const artifacts = new Artifacts(service, files, options.dataDir);
  await artifacts.prune();
  const artifactCleanup = setInterval(
    () => {
      try {
        service.metrics.prune();
      } catch {
        console.warn(JSON.stringify({ event: "environment.metrics_cleanup_failed" }));
      }
      void artifacts.prune().catch(() => {});
    },
    3600000,
  );
  artifactCleanup.unref();
  const app = Fastify({ logger: false, bodyLimit: 10 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: 300,
    timeWindow: "1 minute",
    // 限流插件的错误也走统一业务错误格式，避免被误报为内部错误。
    errorResponseBuilder: (request, limit) => {
      // 只记录路由模板和额度，不写入地址、凭据、实体 ID 或请求正文。
      console.warn(JSON.stringify({
        event: "http.rate_limited", method: request.method, route: request.routeOptions.url,
        scope: request.routeOptions.config.rateLimit ? "route" : "global",
        limit: limit.max, retryAfterSeconds: Math.ceil(limit.ttl / 1000),
      }));
      return new AppError(
        "RATE_LIMIT",
        i18nMessage("errors.RATE_LIMIT.too.many.requests.try.again.later"),
        429,
      );
    },
  });
  await app.register(websocket, { options: { maxPayload: 10 * 1024 * 1024 } });
  const setupPath = join(options.dataDir, "setup-token");
  if (!store.list("users").length && !existsSync(setupPath))
    writeFileSync(setupPath, token(), { mode: 0o600 });
  // 连接名额在认证成功后立即占用，与对账后的可派发连接分开管理。
  const nodeConnections = new Map<string, WebSocket>();
  const registrationChallenges = new Map<
    string,
    { digest: string; expires: number }
  >();
  // 登录挑战只保存在内存中，绑定当时凭据；重启、过期或耗尽尝试后需重新验证密码。
  const loginChallenges = new Map<
    string,
    { userId: string; credentials: string; expires: number; attempts: number }
  >();
  const publicPaths = new Set([
    "/api/auth/status",
    "/api/auth/setup",
    "/api/auth/login",
    "/api/node/light-access",
    "/api/node/challenge",
    "/api/node/register",
    "/api/node/connect",
    "/api/node/connector-updates/:operationId/package",
    "/api/health",
  ]);
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", domain ? "strict-origin-when-cross-origin" : "same-origin")
      .header("X-Frame-Options", "DENY")
      // React 动态布局需要内联样式；脚本仅同源，产物预览继续使用隔离沙箱。
      .header(
        "Content-Security-Policy",
        `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'${lightSource}; frame-src 'self' blob:${lightSource}; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'${lightSource}; frame-ancestors 'none'`,
      );
    // 以路由器实际匹配的模板鉴权，防止编码路径与原始 URL 的解析差异绕过保护。
    const path = req.routeOptions.url || req.url.split("?")[0];
    if (path.startsWith("/api/node/"))
      ensure(
        req.headers.origin === undefined,
        "ORIGIN_DENIED",
        i18nMessage("errors.ORIGIN_DENIED.the.node.endpoint.does.not.accept"),
        403,
      );
    if (path.startsWith("/api/")) reply.header("Cache-Control", "no-store");
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(req.method) &&
      !path.startsWith("/api/node/")
    )
      ensure(
        req.headers.origin === new URL(options.publicUrl).origin,
        "ORIGIN_DENIED",
        i18nMessage("errors.ORIGIN_DENIED.the.request.origin.does.not.match"),
        403,
      );
    if (path.startsWith("/api/") && !publicPaths.has(path)) {
      const raw = req.cookies.relay_session;
      const row = raw
        ? store.db
            .prepare("SELECT * FROM auth_sessions WHERE hash=? AND expires>?")
            .get(digest(raw), Date.now())
        : null;
      ensure(
        row,
        "UNAUTHENTICATED",
        i18nMessage("errors.UNAUTHENTICATED.sign.in.first"),
        401,
      );
    }
    // 所有实体/传输路由统一使用 UUID，鉴权先行避免匿名枚举。
    if (path.startsWith("/api/") && path.includes(":id"))
      idSchema.parse((req.params as { id: string }).id);
  });
  app.addHook("preValidation", async (req) => {
    if (
      /^\/api\/workbench\/:id\/(resume|cancel|compress)$/.test(
        req.routeOptions.url || "",
      )
    )
      z.object({})
        .strict()
        .parse(req.body ?? {});
  });
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header(
      "Content-Language",
      negotiateLocale(req.headers["accept-language"]),
    );
    reply.header(
      "Vary",
      [reply.getHeader("Vary"), "Accept-Language"].filter(Boolean).join(", "),
    );
    return payload;
  });
  app.setErrorHandler((e, req, reply) => {
    const status =
      e instanceof z.ZodError ? 400 : e instanceof AppError ? e.status : 500;
    return reply
      .code(status)
      .send(errorBody(e, negotiateLocale(req.headers["accept-language"])));
  });
  light.register(app);
  app.get("/api/health", async () => ({
    ok: true,
    version: productVersion,
    protocolVersion,
  }));
  // 接入向导与升级提示共用经过实际文件校验的发行清单。
  app.get("/api/connector-release", async () => ({
    release: readConnectorRelease(options.webDir),
  }));
  app.get("/api/auth/status", async (req) => {
    const raw = req.cookies.relay_session;
    const authenticated = !!(
      raw &&
      store.db
        .prepare("SELECT * FROM auth_sessions WHERE hash=? AND expires>?")
        .get(digest(raw), Date.now())
    );
    const user = store.list("users")[0];
    return {
      language: service.languageSettings(authenticated),
      initialized: !!user,
      authenticated,
      ...(authenticated
        ? {
            username: user.username,
            avatar: user.avatar || "",
            totp: !!user.totp,
          }
        : {}),
    };
  });
  // 只接收裁切后的栅格头像，不允许通过个人资料接口修改其他账号字段。
  app.post("/api/auth/avatar", async (req) => {
    const { avatar } = z
      .object({
        avatar: z
          .string()
          .max(350000)
          .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
      })
      .strict()
      .parse(req.body);
    store.put("users", { avatar }, "owner");
    return { ok: true };
  });
  app.post(
    "/api/auth/setup",
    { config: { rateLimit: { max: 5, timeWindow: "1 minute" } } },
    async (req) => {
      ensure(
        !store.list("users").length,
        "ALREADY_SETUP",
        i18nMessage(
          "errors.ALREADY_SETUP.the.administrator.has.already.been.initialized",
        ),
        409,
      );
      const data = z
        .object({
          setupToken: z.string(),
          username: z.string().min(1).max(80),
          password: z.string().min(12).max(200),
        })
        .parse(req.body);
      ensure(
        existsSync(setupPath) &&
          digest(data.setupToken) ===
            digest(readFileSync(setupPath, "utf8").trim()),
        "SETUP_TOKEN",
        i18nMessage("errors.SETUP_TOKEN.invalid.initialization.token"),
        403,
      );
      store.put(
        "users",
        {
          username: data.username,
          password: passwordHash(data.password),
          lastTotp: 0,
        },
        "owner",
      );
      unlinkSync(setupPath);
      return { ok: true };
    },
  );
  app.post(
    "/api/auth/login",
    { config: { rateLimit: { max: 10, timeWindow: "5 minutes" } } },
    async (req, reply) => {
      const data = z
        .union([
          z
            .object({
              challenge: z.string().min(1).max(200),
              code: z.string().regex(/^\d{6}$/),
            })
            .strict(),
          z.object({
            username: z.string().min(1).max(255),
            password: z.string().max(200),
            code: z.string().optional(),
          }),
        ])
        .parse(req.body);
      const user = store.list("users")[0];
      for (const [key, value] of loginChallenges) {
        if (value.expires <= Date.now()) loginChallenges.delete(key);
      }
      const credentials = user
        ? digest(user.password + ":" + (user.totp || ""))
        : "";
      if ("challenge" in data) {
        const key = digest(data.challenge);
        const challenge = loginChallenges.get(key);
        ensure(
          challenge &&
            user &&
            user.totp &&
            challenge.userId === user.id &&
            challenge.credentials === credentials,
          "LOGIN_EXPIRED",
          i18nMessage(
            "errors.LOGIN_EXPIRED.login.verification.expired.enter.your.account",
          ),
          401,
        );
        challenge.attempts -= 1;
        if (challenge.attempts <= 0) loginChallenges.delete(key);
      } else {
        ensure(
          user &&
            user.username === data.username &&
            passwordMatches(data.password, user.password),
          "LOGIN_FAILED",
          i18nMessage("errors.LOGIN_FAILED.incorrect.account.or.credentials"),
          401,
        );
        if (user.totp && !data.code) {
          // 密码通过不签发登录会话；仅发放五分钟、最多五次的二要素挑战。
          const challenge = token();
          if (loginChallenges.size >= 1000)
            loginChallenges.delete(loginChallenges.keys().next().value!);
          loginChallenges.set(digest(challenge), {
            userId: user.id,
            credentials,
            expires: Date.now() + 300000,
            attempts: 5,
          });
          return { requiresTotp: true, challenge };
        }
      }
      if (user.totp) {
        const counter = Math.floor(Date.now() / 30000);
        const offset = data.code
          ? totp(vault.open(user.totp)).validate({
              token: data.code,
              window: 1,
            })
          : null;
        // 记录实际接受的时间步，防止提前窗口中的验证码在下一时间步被重复使用。
        ensure(
          offset !== null && counter + offset > user.lastTotp,
          "TOTP_INVALID",
          i18nMessage("errors.TOTP_INVALID.the.two.factor.code.is.invalid"),
          401,
        );
        store.put("users", { lastTotp: counter + offset }, user.id);
      }
      if ("challenge" in data) loginChallenges.delete(digest(data.challenge));
      const raw = token();
      store.db
        .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
        .run(digest(raw), user.id, Date.now() + 86400000);
      reply.setCookie("relay_session", raw, {
        httpOnly: true,
        sameSite: "strict",
        secure: options.secureCookie ?? true,
        path: "/",
        maxAge: 86400,
      });
      return { ok: true };
    },
  );
  app.post("/api/auth/logout", async (req, reply) => {
    if (req.cookies.relay_session)
      store.db
        .prepare("DELETE FROM auth_sessions WHERE hash=?")
        .run(digest(req.cookies.relay_session));
    reply.clearCookie("relay_session", { path: "/" });
    return { ok: true };
  });
  app.post("/api/auth/password", async (req) => {
    const data = z
      .object({
        currentPassword: z.string(),
        password: z.string().min(12).max(200),
      })
      .parse(req.body);
    const user = store.get("users", "owner");
    ensure(
      passwordMatches(data.currentPassword, user.password),
      "PASSWORD_INVALID",
      i18nMessage("errors.PASSWORD_INVALID.the.current.password.is.incorrect"),
      403,
    );
    store.put("users", { password: passwordHash(data.password) }, user.id);
    store.db.exec("DELETE FROM auth_sessions");
    return { ok: true };
  });
  app.post("/api/auth/totp/setup", async (req) => {
    const { password } = z.object({ password: z.string() }).parse(req.body);
    const user = store.get("users", "owner");
    ensure(
      passwordMatches(password, user.password),
      "PASSWORD_INVALID",
      i18nMessage("errors.PASSWORD_INVALID.incorrect.password"),
      403,
    );
    ensure(
      !user.totp,
      "TOTP_ENABLED",
      i18nMessage(
        "errors.TOTP_ENABLED.disable.existing.two.factor.authentication.using",
      ),
    );
    const secret = new OTPAuth.Secret({ size: 20 }).base32;
    store.put(
      "users",
      {
        pendingTotp: vault.seal(secret),
        pendingTotpExpires: Date.now() + 600000,
      },
      user.id,
    );
    return { secret, uri: totp(secret, user.username).toString() };
  });
  app.post("/api/auth/totp/enable", async (req, reply) => {
    const { code } = z.object({ code: z.string() }).parse(req.body);
    const user = store.get("users", "owner");
    const counter = Math.floor(Date.now() / 30000);
    const offset =
      user.pendingTotp && user.pendingTotpExpires > Date.now()
        ? totp(vault.open(user.pendingTotp)).validate({
            token: code,
            window: 1,
          })
        : null;
    ensure(
      offset !== null,
      "TOTP_INVALID",
      i18nMessage("errors.TOTP_INVALID.invalid.verification.code"),
    );
    // 启用时消费验证码并撤销所有旧会话，只给刚完成验证的浏览器签发新会话。
    const raw = token();
    store.transaction(() => {
      store.put(
        "users",
        {
          totp: user.pendingTotp,
          pendingTotp: null,
          pendingTotpExpires: null,
          lastTotp: counter + offset,
        },
        user.id,
      );
      store.db.exec("DELETE FROM auth_sessions");
      store.db
        .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
        .run(digest(raw), user.id, Date.now() + 86400000);
    });
    reply.setCookie("relay_session", raw, {
      httpOnly: true,
      sameSite: "strict",
      secure: options.secureCookie ?? true,
      path: "/",
      maxAge: 86400,
    });
    return { ok: true };
  });
  app.post("/api/auth/totp/disable", async (req) => {
    const { password, code } = z
      .object({ password: z.string(), code: z.string() })
      .parse(req.body);
    const user = store.get("users", "owner");
    const counter = Math.floor(Date.now() / 30000);
    const offset = user.totp
      ? totp(vault.open(user.totp)).validate({ token: code, window: 1 })
      : null;
    ensure(
      passwordMatches(password, user.password) &&
        offset !== null &&
        counter + offset > user.lastTotp,
      "AUTH_INVALID",
      i18nMessage(
        "errors.AUTH_INVALID.incorrect.password.or.verification.code",
      ),
      403,
    );
    store.put("users", { totp: null }, user.id);
    return { ok: true };
  });
  app.get<{ Params: { id: string }; Querystring: { window?: string } }>(
    "/api/environments/:id/traffic", async (req) => {
      const env = store.get("environments", req.params.id);
      ensure(!env.revoked, "REVOKED", i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"), 403);
      ensure(env.approved, "FORBIDDEN", i18nMessage("errors.FORBIDDEN.the.environment.is.not.accessible"), 403);
      return service.metrics.history(env.id, trafficWindow.default("24h").parse(req.query.window));
    },
  );
  app.get("/api/state", async () => service.stateSnapshot());
  // 每组独立比较，未变化的组在响应中省略；摘要也覆盖其他标签页和环境产生的变化。
  const stateGroup = z.enum(["projects", "agents", "models", "sessions", "environments",
    "sessionProjectIds", "boardSummaries", "board", "boardPage"]);
  const stateQuery = z.object({
    groups: z.array(stateGroup).min(1).max(stateGroup.options.length),
    known: z.partialRecord(stateGroup, z.string().regex(/^[a-f0-9]{64}$/)).default({}),
    boardId: idSchema.optional(),
    includeArchived: z.boolean().default(false),
  }).strict().refine(query => !query.groups.some(group => group === "boardPage" || group === "board") || !!query.boardId);
  // 每组只记最近一次摘要。SQLite 本连接写入、外部提交或在线集合变化都会使快路径失效。
  const recentRevisions = new Map<string, { scope: string; revision: string }>();
  const dbRevision = store.db.prepare("SELECT total_changes() AS writes, data_version FROM pragma_data_version");
  app.post("/api/state/query", async (req, reply) => {
    const query = stateQuery.parse(req.body);
    const changes: Record<string, { revision: string; value: unknown }> = {};
    const generation = JSON.stringify([dbRevision.get(), [...service.peers.keys()]]);
    for (const group of new Set(query.groups)) {
      const scope = JSON.stringify([generation, query.boardId, query.includeArchived]);
      const cached = recentRevisions.get(group);
      // 环境更新阻塞原因还取决于内存中的传输任务，需要每次向服务层核实。
      if (group !== "environments" && cached?.scope === scope && cached.revision === query.known[group]) continue;
      let value: unknown;
      switch (group) {
        case "boardSummaries": value = service.boardSummaries(); break;
        case "board": value = store.get("boards", query.boardId!); break;
        case "boardPage": value = service.boardPage(query.boardId!, query.includeArchived); break;
        case "sessionProjectIds": value = service.sessionProjectIds(store.list("projects")); break;
        default: value = service.list(group);
      }
      const revision = digest(JSON.stringify(value));
      recentRevisions.set(group, { scope, revision });
      if (query.known[group] !== revision) changes[group] = { revision, value };
    }
    reply.header("Cache-Control", "no-store");
    return { changes };
  });
  app.put("/api/projects/order", async (req) => {
    const { projectIds } = z.object({ projectIds: z.array(idSchema) }).strict().parse(req.body);
    return service.saveSessionProjectOrder(projectIds);
  });
  app.put("/api/agents/order", async (req) => {
    const { agentIds } = z.object({ agentIds: z.array(idSchema) }).strict().parse(req.body);
    return service.saveAgentOrder(agentIds);
  });
  for (const kind of ["projects", "agents", "boards", "models"]) {
    app.post("/api/" + kind, async (req) =>
      kind === "projects" ? service.createProject(req.body) : service.save(kind, req.body));
    app.put<{ Params: { id: string } }>("/api/" + kind + "/:id", async (req) =>
      service.save(kind, req.body, req.params.id, (req.body as any).version),
    );
    app.delete<{ Params: { id: string } }>(
      "/api/" + kind + "/:id",
      async (req) => service.remove(kind, req.params.id),
    );
  }
  app.patch<{ Params: { id: string } }>(
    "/api/boards/:id/title",
    {
      // 复用实体存储留存结果，不记录标题、请求正文或凭据；不暴露到 state。
      onResponse: async (req, reply) => {
        const raw = req.cookies.relay_session;
        const actor = raw
          ? store.db
              .prepare(
                "SELECT owner FROM auth_sessions WHERE hash=? AND expires>?",
              )
              .get(digest(raw), Date.now())
          : undefined;
        store.put("boardTitleAudit", {
          boardId: req.params.id,
          actorId: actor?.owner ?? null,
          action: "board.title.update",
          statusCode: reply.statusCode,
          result: reply.statusCode < 400 ? "success" : "failure",
        });
      },
    },
    async (req) => service.renameBoard(req.params.id, req.body),
  );
  app.get<{ Params: { id: string } }>(
    "/api/boards/:id/editability",
    async (req) => service.boardEditability(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/boards/:id/flow-preview",
    async (req) => {
      const body = z
        .object({
          version: z.number().int().min(1),
          board: z.record(z.string(), z.unknown()),
        })
        .parse(req.body);
      return service.previewBoardFlow(req.params.id, body.board, body.version);
    },
  );
  app.post<{ Params: { id: string } }>("/api/boards/:id/copy", async (req) =>
    service.copyBoard(
      req.params.id,
      z.object({ operationId: idSchema.optional() }).parse(req.body ?? {})
        .operationId,
      negotiateLocale(req.headers["accept-language"]),
    ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/boards/:id/uploads",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return boardUploads.begin(
        req.params.id,
        digest(req.cookies.relay_session || ""),
        req.body,
      );
    },
  );
  app.get<{ Params: { id: string } }>("/api/sessions/:id/board-confirmations", async req =>
    sessionBoards.pending(req.params.id));
  app.post<{ Params: { id: string; requestId: string } }>("/api/sessions/:id/board-confirmations/:requestId", async req =>
    sessionBoards.decide(req.params.id, req.params.requestId, z.object({ approve: z.boolean() }).strict().parse(req.body).approve));
  app.get<{ Params: { boardId: string; itemId: string } }>("/api/boards/:boardId/items/:itemId", async req => {
    return sessionBoards.detail(req.params.boardId, req.params.itemId);
  });
  app.post("/api/items", async (req) =>
    service.createItem(
      req.body,
      await boardUploads.prepare(
        digest(req.cookies.relay_session || ""),
        req.body,
      ),
    ),
  );
  app.get<{ Params: { id: string } }>("/api/items/:id/edit", async (req) =>
    service.itemEditView(req.params.id),
  );
  app.patch<{ Params: { id: string } }>("/api/items/:id", async (req) =>
    service.editItem(
      req.params.id,
      req.body,
      await boardUploads.prepare(
        digest(req.cookies.relay_session || ""),
        req.body,
      ),
    ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/items/:id/advance",
    async (req) => {
      const d = z
        .object({
          targetId: z.string().uuid(),
          record: z.string().optional().default(""),
          operationId: z.string().uuid(),
          expectedStageId: z.string().uuid(),
          expectedVersion: z.number().int().positive(),
        })
        .parse(req.body);
      return service.advance(
        req.params.id,
        d.targetId,
        d.record,
        d.operationId,
        undefined,
        [],
        undefined,
        false,
        { stageId: d.expectedStageId, version: d.expectedVersion },
        await boardUploads.prepare(
          digest(req.cookies.relay_session || ""),
          req.body,
        ),
      );
    },
  );
  app.post<{ Params: { id: string } }>("/api/items/:id/retry", async (req) =>
    service.retry(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/items/:id/archive",
    async (req) => {
      const { archived } = z.object({ archived: z.boolean() }).parse(req.body);
      return service.archiveItem(req.params.id, archived);
    },
  );
  /** 会话层选择唯一目标；通用下发层不接受浏览器指定路径或环境。 */
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/uploads",
    async (req, reply) => {
      const { files: entries } = z
        .object({ files: uploadEntriesSchema })
        .strict()
        .parse(req.body);
      const session = store.get("sessions", req.params.id);
      const peer = service.peer(session.environmentId);
      const owner = digest(req.cookies.relay_session || "");
      const revalidate = () => {
        ensure(
          store.db
            .prepare(
              "SELECT hash FROM auth_sessions WHERE hash=? AND expires>?",
            )
            .get(owner, Date.now()),
          "UNAUTHENTICATED",
          i18nMessage("errors.UNAUTHENTICATED.your.login.has.expired.sign.in"),
          401,
        );
        const current = store.get("sessions", session.id);
        const env = store.get("environments", session.environmentId);
        ensure(
          env.approved &&
            !env.revoked &&
            current.environmentId === session.environmentId &&
            current.rootId === session.rootId &&
            current.relativePath === session.relativePath,
          "FILE_SCOPE",
          i18nMessage(
            "errors.FILE_SCOPE.file.access.authorization.has.changed",
          ),
          403,
        );
        ensure(
          env.capabilities?.includes(uploadCapability),
          "CONNECTOR_UPGRADE",
          i18nMessage("uploads.upgrade"),
          409,
        );
        ensure(
          service.peer(session.environmentId) === peer,
          "OFFLINE",
          i18nMessage(
            "errors.OFFLINE.the.environment.connection.has.changed.try",
          ),
          409,
        );
        ensure(
          !current.archived &&
            !service.updating(session.environmentId) &&
            !service.active(session.id) &&
            ![
              "queued",
              "dispatching",
              "running",
              "waiting",
              "unknown",
              "stopping",
            ].includes(current.status),
          "UPLOAD_BLOCKED",
          i18nMessage("uploads.blocked"),
          409,
        );
      };
      reply.header("Cache-Control", "no-store");
      return uploads.create(
        owner,
        {
          peer,
          revalidate,
          destination: {
            kind: "session-attachments",
            sessionId: session.id,
            rootId: session.rootId,
            relativePath: session.relativePath,
          },
        },
        entries,
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/file-uploads/:id/write",
    {
      bodyLimit: 360 * 1024,
      config: { rateLimit: { max: 2400, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      return uploads.call(
        digest(req.cookies.relay_session || ""),
        req.params.id,
        "write",
        req.body,
      );
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/file-uploads/:id/finish",
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const result = await uploads.call(
        digest(req.cookies.relay_session || ""),
        req.params.id,
        "finish",
        {},
      );
      return z
        .object({
          files: attachmentsSchema,
          attachmentReceipt: z.string().optional(),
        })
        .parse(result);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/file-uploads/:id",
    async (req) => {
      await uploads.cancel(
        digest(req.cookies.relay_session || ""),
        req.params.id,
      );
      return { ok: true };
    },
  );
  /** 当前业务入口将会话索引转换成传输授权；浏览器不能指定任意环境或工作目录。 */
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/files",
    async (req) => {
      const { href } = z
        .object({ href: z.string().min(1).max(4096) })
        .strict()
        .parse(req.body);
      const link = classifyFileLink(href);
      ensure(
        link.kind === "file",
        "PATH_INVALID",
        i18nMessage("errors.PATH_INVALID.this.is.not.a.readable.environment"),
      );
      const session = store.get("sessions", req.params.id);
      const environment = store.get("environments", session.environmentId);
      ensure(
        environment.capabilities?.includes("files-v1"),
        "CONNECTOR_UPGRADE",
        i18nMessage(
          "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.view",
        ),
        409,
      );
      const peer = service.peer(session.environmentId);
      const owner = digest(req.cookies.relay_session || "");
      const revalidate = () => {
        const login = store.db
          .prepare("SELECT hash FROM auth_sessions WHERE hash=? AND expires>?")
          .get(owner, Date.now());
        ensure(
          login,
          "UNAUTHENTICATED",
          i18nMessage("errors.UNAUTHENTICATED.your.login.has.expired.sign.in"),
          401,
        );
        const current = store.get("sessions", session.id);
        const env = store.get("environments", session.environmentId);
        ensure(
          env.approved &&
            !env.revoked &&
            current.environmentId === session.environmentId &&
            current.rootId === session.rootId &&
            current.relativePath === session.relativePath,
          "FILE_SCOPE",
          i18nMessage(
            "errors.FILE_SCOPE.file.access.authorization.has.changed",
          ),
          403,
        );
        ensure(
          service.peer(session.environmentId) === peer,
          "OFFLINE",
          i18nMessage(
            "errors.OFFLINE.the.environment.connection.has.changed.open",
          ),
          409,
        );
      };
      return files.create(owner, {
        peer,
        revalidate,
        source: {
          rootId: session.rootId,
          relativePath: session.relativePath,
          path: link.value,
        },
      });
    },
  );
  // 分块接口每次经过登录校验和业务授权；二进制响应不能被浏览器当成可执行文档。
  app.post<{ Params: { id: string } }>(
    "/api/file-transfers/:id/read",
    {
      config: { rateLimit: { max: 2400, timeWindow: "1 minute" } },
    },
    async (req, reply) => {
      const { offset } = z
        .object({
          offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        })
        .strict()
        .parse(req.body);
      const bytes = await files.read(
        digest(req.cookies.relay_session || ""),
        req.params.id,
        offset,
      );
      return reply
        .header("Content-Type", "application/octet-stream")
        .header("Content-Disposition", "attachment")
        .header("Cache-Control", "no-store")
        .send(bytes);
    },
  );
  app.delete<{ Params: { id: string } }>(
    "/api/file-transfers/:id",
    async (req) => {
      files.cancel(digest(req.cookies.relay_session || ""), req.params.id);
      return { ok: true };
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/artifacts/:id/files",
    async (req) => {
      const owner = digest(req.cookies.relay_session || "");
      return artifacts.ticket(req.params.id, owner, () => {
        ensure(
          store.db
            .prepare(
              "SELECT hash FROM auth_sessions WHERE hash=? AND expires>?",
            )
            .get(owner, Date.now()),
          "UNAUTHENTICATED",
          i18nMessage("errors.UNAUTHENTICATED.your.login.has.expired.sign.in"),
          401,
        );
      });
    },
  );
  /** 按会话索引固定环境和目录，搜索响应不持久化且不进入 PWA 缓存。 */
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/mentions",
    async (req, reply) => {
      const { query } = z
        .object({ query: z.string().max(512) })
        .strict()
        .parse(req.body);
      const session = store.get("sessions", req.params.id);
      const environment = store.get("environments", session.environmentId);
      ensure(
        environment.approved && !environment.revoked,
        "FORBIDDEN",
        i18nMessage("errors.FORBIDDEN.the.environment.is.not.accessible"),
        403,
      );
      ensure(
        environment.capabilities?.includes("mentions-v1"),
        "CONNECTOR_UPGRADE",
        i18nMessage(
          "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.use",
        ),
        409,
      );
      const peer = service.peer(session.environmentId);
      let searchError: unknown;
      const result = await peer.call("mentions.search", {
        rootId: session.rootId,
        relativePath: session.relativePath,
        runtime: session.runtime,
        query,
      }).catch((error: unknown) => {
        searchError = error;
        return {
          items: [],
          warning: translate("zh-CN", "connector.mentions.environmentUnavailable"),
          warningMessages: [i18nMessage("connector.mentions.environmentUnavailable")],
        };
      });
      const current = store.get("environments", session.environmentId);
      ensure(
        current.approved &&
          !current.revoked &&
          service.peer(session.environmentId) === peer,
        "OFFLINE",
        i18nMessage(
          "errors.OFFLINE.the.environment.connection.has.changed.try",
        ),
        409,
      );
      reply.header("Cache-Control", "no-store");
      const local = z
        .object({
          items: z.array(mentionItemSchema).max(10),
          warning: z.string().max(2000).optional(),
          warningMessages: z
            .array(
              z.object({
                messageKey: z.string().max(200),
                messageParams: z.object({}),
              }),
            )
            .max(5)
            .optional(),
        })
        .parse(result);
      const needle = query.trim().toLowerCase();
      const boards: MentionItem[] = current.capabilities?.includes(boardCapability)
        ? store.list("boards")
          .filter(b => b.ownerId === session.ownerId && b.name.toLowerCase().includes(needle))
          .map(b => ({ kind: "board" as const, path: b.id, name: b.name, projectId: b.projectId }))
          .sort((a, b) => mentionRank(a, needle) - mentionRank(b, needle))
          .slice(0, 20)
          .map(({ projectId, ...b }) => ({ ...b,
            description: (store.findBy("projects", "id", projectId)[0]?.name ?? "") + " · " + b.path }))
        : [];
      if (searchError && (!boards.length || !(searchError instanceof AppError) ||
        !["INTERNAL", "RPC_ERROR", "STATUS_UNKNOWN", "ROOT_UNKNOWN", "NOT_DIRECTORY"].includes(searchError.code)))
        throw searchError;
      // 明确的精确引用优先，其后预留看板位置，部分板名不受环境候选数量影响。
      const priority = (item: MentionItem) =>
        mentionRank(item, needle) === 0 ? (item.kind === "board" ? 0 : 1)
          : item.kind === "board" ? 2 : 3;
      const items = [...boards, ...local.items.filter(i => i.kind !== "board")];
      return { ...local, items: items.sort((a, b) => priority(a) - priority(b)) };

    },
  );
  app.post<{ Params: { id: string; operation: string } }>(
    "/api/environments/:id/model-config/:operation",
    async (req) => {
      const operation = modelOperation.parse(req.params.operation);
      const input = (operation === "read" ? modelSelection : modelDraft)
        .strict()
        .parse(req.body);
      const env = store.get("environments", req.params.id);
      ensure(
        !env.revoked,
        "REVOKED",
        i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"),
        403,
      );
      ensure(
        env.approved,
        "FORBIDDEN",
        i18nMessage("errors.FORBIDDEN.the.environment.is.not.accessible"),
        403,
      );
      const peer = service.peer(env.id);
      ensure(
        env.capabilities?.includes(modelConfigCapability),
        "CONNECTOR_UPGRADE",
        i18nMessage("environment.modelConfig.upgrade"),
        409,
      );
      if ("apiKey" in input && input.apiKey)
        ensure(
          new URL(options.publicUrl).protocol === "https:",
          "HTTPS_REQUIRED",
          i18nMessage("errors.HTTPS_REQUIRED.remote.connections.require.https"),
        );
      try {
        const result = await peer.call(
          "environment.modelConfig",
          { operation, input },
          30000,
        );
        ensure(
          service.peers.get(env.id) === peer,
          "OFFLINE",
          i18nMessage("errors.OFFLINE.the.environment.connection.has.changed"),
          409,
        );
        if (operation === "read" || operation === "save") {
          const summary = modelResults[operation].parse(result);
          const tools = store.get("environments", env.id).tools;
          // 上次已探测到 Claude CLI，唯一缺项是本机模型凭据。
          if (
            summary.provider === "claude" &&
            summary.customEndpoint &&
            summary.hasKey &&
            tools?.claude?.messageKey === "connector.runtime.claudeConfig"
          ) {
            store.put("environments", {
              tools: { ...tools, claude: { available: true, version: tools.claude.version } },
            }, env.id);
          }
          return summary;
        }
        return modelResults[operation].parse(result);
      } catch (error) {
        // 发送后失联或回执无效时，不能认定环境写入失败。
        if (
          operation === "save" &&
          (!(error instanceof AppError) ||
            ["STATUS_UNKNOWN", "OFFLINE"].includes(error.code))
        )
          throw new AppError(
            "STATUS_UNKNOWN",
            i18nMessage("environment.modelConfig.unconfirmed"),
            504,
          );
        throw error;
      }
    },
  );
  app.route<{ Params: { id: string } }>({
    method: ["GET", "POST"],
    url: "/api/environments/:id/claude-sdk",
    async handler(req) {
      const install = req.method === "POST";
      if (install) z.object({}).strict().parse(req.body);
      const env = store.get("environments", req.params.id);
      ensure(!env.revoked, "REVOKED", i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"), 403);
      ensure(env.approved, "FORBIDDEN", i18nMessage("errors.FORBIDDEN.the.environment.is.not.accessible"), 403);
      if (install) service.requireEnabledRuntime(env, "claude");
      const peer = service.peer(env.id);
      ensure(env.capabilities?.includes(claudeSdkCapability), "CONNECTOR_UPGRADE", i18nMessage("connector.support.upgrade"), 409);
      try {
        const result = install
          ? await peer.call("claude.sdk.install", {}, 180000)
          : await peer.call("claude.sdk.status");
        const status = claudeSdkStatus.parse(result);
        ensure(service.peers.get(env.id) === peer, "OFFLINE", i18nMessage("errors.OFFLINE.the.environment.connection.has.changed"), 409);
        if (install && status.state === "installed") await service.refreshClaudeSettings(env.id);
        return status;
      } catch (error) {
        // 已下发的写请求可能仍在环境端执行，断线后只允许查询。
        if (install && (!(error instanceof AppError) || ["OFFLINE", "STATUS_UNKNOWN"].includes(error.code)))
          throw new AppError("STATUS_UNKNOWN", i18nMessage("connector.support.unconfirmed"), 504);
        throw error;
      }
    },
  });
  /** 仅返回能力与非敏感默认值，凭据和原生配置正文留在环境。 */
  app.get<{ Params: { id: string } }>("/api/environments/:id/runtime-settings", async (req) =>
    service.runtimeSettings(await service.refreshClaudeSettings(req.params.id)),
  );
  app.patch<{ Params: { id: string } }>("/api/environments/:id/runtime-settings", async (req) => {
    const { runtime, enabled } = z.object({
      runtime: cliRuntimeSchema, enabled: z.boolean(),
    }).strict().parse(req.body);
    return service.setRuntimeEnabled(req.params.id, runtime, enabled);
  });
  app.post<{ Params: { id: string } }>(
    "/api/environments/:id/runtime-catalog",
    async (req, reply) => {
      const input = z
        .object({
          runtime: cliRuntimeSchema,
          rootId: z.string().optional(),
          relativePath: z.string().default("."),
        })
        .strict()
        .parse(req.body);
      const env = store.get("environments", req.params.id);
      ensure(
        env.approved && !env.revoked,
        "FORBIDDEN",
        i18nMessage("errors.FORBIDDEN.the.environment.is.not.accessible"),
        403,
      );
      service.requireEnabledRuntime(env, input.runtime);
      ensure(
        env.capabilities?.includes("runtime-options-v1"),
        "CONNECTOR_UPGRADE",
        i18nMessage(
          "errors.CONNECTOR_UPGRADE.upgrade.the.environment.connector.to.retrieve",
        ),
        409,
      );
      const peer = service.peer(env.id);
      const result = await peer.call("runtime.catalog", input, 45000);
      const current = store.get("environments", env.id);
      ensure(
        current.approved && !current.revoked && service.peer(env.id) === peer,
        "OFFLINE",
        i18nMessage("errors.OFFLINE.the.environment.connection.has.changed"),
        409,
      );
      reply.header("Cache-Control", "no-store");
      service.requireEnabledRuntime(current, input.runtime);
      const catalog = runtimeCatalogSchema.parse(result);
      if (catalog.warningDetails)
        catalog.warning = localizeError(
          negotiateLocale(req.headers["accept-language"]),
          catalog.warningDetails,
        );
      return catalog;
    },
  );
  app.post<{ Params: { id: string } }>("/api/sessions/:id/terminal",
    { config: { rateLimit: { max: 2400, timeWindow: "1 minute" } } },
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const input = terminalAction.parse(req.body);
      const session = store.get("sessions", req.params.id);
      const env = store.get("environments", session.environmentId);
      ensure(session.claudeMode === "environment" && session.runtime === "claude" &&
        !session.archived && env.approved && !env.revoked,
        "FORBIDDEN", i18nMessage("connector.native.unavailable"), 403);
      if (input.action !== "close") {
        service.requireEnabledRuntime(env, "claude");
        const project = store.get("projects", session.projectId);
        ensure(project.directories.some((dir: any) => dir.environmentId === env.id &&
          dir.rootId === session.rootId && dir.relativePath === session.relativePath),
          "DIRECTORY_MISMATCH", i18nMessage("errors.DIRECTORY_MISMATCH.the.directory.must.be.registered.in"), 403);
      }
      const peer = service.peer(env.id);
      // 启动等待期间归档也须看到忙碌，断线后可用 close 收敛未知状态。
      if (input.action === "open" && session.status !== "running") {
        service.sessionAgentForExecution(session);
        store.put("sessions", { status: "running" }, session.id);
      }
      const result = await peer.call("claude.terminal", {
        sessionId: session.id, rootId: session.rootId, relativePath: session.relativePath, input,
      });
      ensure(service.peer(env.id) === peer, "OFFLINE", i18nMessage("connector.native.unavailable"), 409);
      if ((input.action === "close" || result?.exited) && store.get("sessions", session.id).status === "running")
        store.put("sessions", { status: "idle" }, session.id);
      return result;
    });
  app.post("/api/sessions", async (req) => {
    const input = req.body as { runtime?: string; environmentId?: string } | null;
    if (input?.runtime === "claude" && typeof input.environmentId === "string")
      await service.refreshClaudeSettings(input.environmentId);
    return service.createSession(req.body, true, true);
  });
  app.post<{ Params: { id: string } }>("/api/environments/:id/commands", async (req, reply) => {
    const input = z.union([
      commandScope.pick({runtime: true}).strict(),
      commandScope.omit({ environmentId: true }).extend({
        cached: z.boolean().default(false), change: commandChange.optional(),
      }).strict(),
    ]).parse(req.body);
    reply.header("Cache-Control", "no-store");
    if (!("projectId" in input)) {
      const env = store.get("environments", req.params.id);
      ensure(env.approved && !env.revoked, "FORBIDDEN", i18nMessage("errors.FORBIDDEN.the.environment.is.not.accessible"), 403);
      return { fixed: fixedCommands, items: [] };
    }
    const scope = commandScope.parse({ ...input, environmentId: req.params.id });
    const peer = commandPeer(service, scope);
    const result = input.change
      ? await peer.call("commands.save", { ...scope, change: input.change })
      : await peer.call("commands.list", { ...scope, cached: input.cached });
    ensure(commandPeer(service, scope) === peer, "OFFLINE", i18nMessage("slash.stale"), 409);
    return input.change ? { item: commandEntry.parse(result) } : { fixed: fixedCommands, items: commandEntry.array().parse(result) };
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/commands", async (req, reply) => {
    const session = store.get("sessions", req.params.id);
    ensure(!session.archived && session.claudeMode !== "environment", "COMMAND_UNSUPPORTED", i18nMessage("slash.unsupported"), 409);
    const scope = commandScope.parse(session);
    const peer = commandPeer(service, scope);
    const rows = commandEntry.array().parse(await peer.call("commands.list", scope));
    ensure(commandPeer(service, scope) === peer, "OFFLINE", i18nMessage("slash.stale"), 409);
    reply.header("Cache-Control", "no-store");
    return { fixed: fixedCommands, items: rows.filter(r => r.enabled && r.execution) };
  });
  app.post<{ Params: { id: string } }>("/api/sessions/:id/send", async req =>
    manualSend(service, req.params.id, manualSendSchema.parse(req.body)));
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/history",
    async (req) => {
      await sessionBoards.recoverCards(req.params.id);
      return service.sessionHistory(req.params.id);
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/sessions/:id/config",
    async (req) => service.configureSession(req.params.id, req.body),
  );
  app.put<{ Params: { id: string } }>("/api/sessions/:id/pin", async (req) => {
    const { pinned } = z.object({ pinned: z.boolean() }).strict().parse(req.body);
    return service.setSessionPinned(req.params.id, pinned);
  });
  app.post("/api/sessions/manage", async (req) => {
    const data = z
      .object({
        ids: z.array(z.string().uuid()).min(1).max(200),
        action: z.enum(["delete", "archive", "restore"]),
      })
      .parse(req.body);
    return service.manageSessions(data.ids, data.action);
  });
  // SSE 经过同一 Cookie 鉴权，心跳复核登录有效期；代理不应缓存流式响应。
  app.get<{ Params: { id: string } }>(
    "/api/sessions/:id/events",
    async (req, reply) => {
      const id = req.params.id;
      const environmentChannel = "environment:" + store.get("sessions", id).environmentId;
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
        Connection: "keep-alive",
      });
      const send = (data: any) => {
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        // 慢客户端断开后从环境重新对账，避免服务端无限积累会话正文。
        if (reply.raw.writableLength > 1024 * 1024) {
          reply.raw.destroy();
          return;
        }
        if (!reply.raw.destroyed)
          reply.raw.write("data: " + JSON.stringify(data) + "\n\n");
      };
      service.sessionEvents.on(id, send);
      service.sessionEvents.on(environmentChannel, send);
      send({ type: "ready" });
      const heartbeat = setInterval(() => {
        const valid = store.db
          .prepare("SELECT hash FROM auth_sessions WHERE hash=? AND expires>?")
          .get(digest(req.cookies.relay_session || ""), Date.now());
        if (!valid) reply.raw.end();
        else if (!reply.raw.destroyed) reply.raw.write(": heartbeat\n\n");
      }, 15000);
      reply.raw.on("close", () => {
        clearInterval(heartbeat);
        service.sessionEvents.off(id, send);
        service.sessionEvents.off(environmentChannel, send);
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/executions/:id/stop",
    async (req) => service.stop(req.params.id),
  );
  app.get<{ Params: { id: string; interactionId: string } }>(
    "/api/executions/:id/interactions/:interactionId",
    async (req) => {
      const e = service.execution(req.params.id);
      ensure(
        store
          .get("environments", e.environment_id)
          .capabilities?.includes("user-questions-v1"),
        "CONNECTOR_UPGRADE_REQUIRED",
        i18nMessage("questions.upgrade"),
        409,
      );
      return service.peer(e.environment_id).call("interaction.status", {
        executionId: e.id,
        interactionId: z.string().uuid().parse(req.params.interactionId),
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/executions/:id/answer",
    async (req) => {
      const d = z
        .object({
          interactionId: z.string().uuid(),
          answer: z.record(z.string(), z.unknown()),
        })
        .parse(req.body);
      const e = service.execution(req.params.id);
      if (Array.isArray(d.answer.answers))
        ensure(
          store
            .get("environments", e.environment_id)
            .capabilities?.includes("user-questions-v1"),
          "CONNECTOR_UPGRADE_REQUIRED",
          i18nMessage("questions.upgrade"),
          409,
        );
      return service
        .peer(e.environment_id)
        .call("interaction.answer", { ...d, executionId: e.id });
    },
  );
  app.post("/api/directory/list", async (req) => {
    const data = z
      .object({
        environmentId: idSchema,
        rootId: z.string().min(1).max(256),
        relativePath: z.string().max(4096).default("."),
      })
      .strict()
      .parse(req.body);
    return service.peer(data.environmentId).call("directory.list", data);
  });
  app.post("/api/directory/validate", async (req) => {
    const d = z
      .object({
        environmentId: z.string().uuid(),
        rootId: z.string().min(1).max(256),
        relativePath: z.string().max(4096),
      })
      .strict()
      .parse(req.body);
    return service.peer(d.environmentId).call("directory.validate", d);
  });
  app.post("/api/directory/create", async (req) => {
    const d = z
      .object({
        environmentId: z.string().uuid(),
        rootId: z.string().min(1).max(256),
        parent: z.string().max(4096),
        name: z.string().min(1).max(255),
      })
      .strict()
      .parse(req.body);
    return service.peer(d.environmentId).call("directory.create", d);
  });
  // 专用设置接口继承登录与来源校验，与工作台提示词工具共用严格保存契约。
  app.post<{ Params: { id: string } }>(
    "/api/environments/:id/connector-updates",
    async (req, reply) => {
      return reply
        .code(202)
        .send(connectorUpdates.start(req.params.id, req.body));
    },
  );
  app.get<{ Params: { id: string } }>(
    "/api/environments/:id/connector-updates/blockers",
    req => connectorUpdates.blockers(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/environments/:id/connector-updates/blockers/stop",
    req => connectorUpdates.stopBlocker(req.params.id, req.body),
  );
  app.get<{ Params: { id: string; operationId: string } }>(
    "/api/environments/:id/connector-updates/:operationId",
    async (req) => {
      return connectorUpdates.get(
        req.params.id,
        idSchema.parse(req.params.operationId),
      );
    },
  );
  app.get<{ Params: { operationId: string } }>(
    "/api/node/connector-updates/:operationId/package",
    async (req, reply) => {
      const { path, size } = await connectorUpdates.packageFile(
        req.headers.authorization,
        idSchema.parse(req.params.operationId),
      );
      // 每次 Range 都重新核验授权与冻结内容，只支持单段连续范围。
      let start = 0,
        end = size - 1;
      if (req.headers.range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
        ensure(
          match,
          "RANGE_INVALID",
          i18nMessage("errors.RANGE_INVALID.invalid.download.range"),
          416,
        );
        start = Number(match[1]);
        end = match[2] ? Number(match[2]) : end;
        ensure(
          Number.isSafeInteger(start) &&
            Number.isSafeInteger(end) &&
            start >= 0 &&
            end >= start &&
            end < size,
          "RANGE_INVALID",
          i18nMessage("errors.RANGE_INVALID.invalid.download.range"),
          416,
        );
        reply
          .code(206)
          .header("Content-Range", `bytes ${start}-${end}/${size}`);
      }
      return reply
        .header("Cache-Control", "no-store")
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", end - start + 1)
        .type("application/octet-stream")
        .send(createReadStream(path, { start, end }));
    },
  );
  app.post("/api/settings/language", async (req) =>
    service.saveLanguage(req.body),
  );
  app.get("/api/settings/downloads", async () => downloads.settings());
  app.post("/api/settings/downloads", async (req) =>
    downloads.configure(req.body),
  );
  app.post("/api/connector-downloads", async (req) => {
    const { file } = z
      .object({ file: z.string().min(1).max(255) })
      .strict()
      .parse(req.body);
    const release = readConnectorRelease(options.webDir);
    ensure(
      release?.releases.some((item) => item.file === file),
      "DOWNLOAD_NOT_FOUND",
      i18nMessage(
        "errors.DOWNLOAD_NOT_FOUND.the.current.release.package.does.not",
      ),
      404,
    );
    return downloads.issue(digest(req.cookies.relay_session || ""), file);
  });
  app.get("/api/settings/workbench-prompt", async () =>
    workbench.promptSettings(),
  );
  app.post("/api/settings/workbench-prompt", async (req) =>
    workbench.savePromptSettings(req.body),
  );
  app.post("/api/workbench/manage", async (req) =>
    workbench.manageBatch(req.body),
  );
  app.get<{ Querystring: { archived?: string } }>(
    "/api/workbench",
    async (req) =>
      store
        .listWorkbenchSummaries(req.query.archived === "true")
        .sort(compareSessionActivity),
  );
  app.post("/api/workbench", async (req) =>
    workbench.public(workbench.create(req.body)),
  );
  app.get<{ Params: { id: string } }>("/api/workbench/:id", async (req) =>
    workbench.public(store.get("workbench", req.params.id)),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workbench/:id/config",
    async (req) => workbench.configure(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workbench/:id/manage",
    async (req) => workbench.manage(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>("/api/workbench/:id/send", async (req) =>
    workbench.start(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workbench/:id/resume",
    async (req) => workbench.resume(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workbench/:id/approve",
    async (req) => workbench.approve(req.params.id, req.body),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workbench/:id/cancel",
    async (req) => workbench.cancel(req.params.id),
  );
  app.post<{ Params: { id: string } }>(
    "/api/workbench/:id/compress",
    async (req) => workbench.public(await workbench.compress(req.params.id)),
  );
  app.post("/api/invitations", async () => {
    const code = token();
    store.db
      .prepare("INSERT INTO invitations VALUES(?,?,0)")
      .run(digest(code), Date.now() + 600000);
    return { code, expiresIn: 600, serverUrl: options.publicUrl };
  });
  app.post(
    "/api/node/challenge",
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
    },
    async (req) => {
      const d = registrationSchema.parse(req.body);
      const payloadDigest = registrationDigest(d);
      // 只为有效接入码签发短期证明，不提前消费接入码。
      ensure(
        store.db
          .prepare(
            "SELECT hash FROM invitations WHERE hash=? AND used=0 AND expires>?",
          )
          .get(digest(d.code), Date.now()),
        "INVITATION_INVALID",
        i18nMessage("errors.INVITATION_INVALID.the.access.code.is.invalid.or"),
        403,
      );
      for (const [id, challenge] of registrationChallenges)
        if (challenge.expires <= Date.now()) registrationChallenges.delete(id);
      ensure(
        registrationChallenges.size < 5000,
        "CHALLENGE_LIMIT",
        i18nMessage(
          "errors.CHALLENGE_LIMIT.too.many.connection.requests.try.again",
        ),
        429,
      );
      const challenge = token();
      registrationChallenges.set(challenge, {
        digest: payloadDigest,
        expires: Date.now() + 60000,
      });
      return {
        challenge,
        authVersion: nodeAuthVersion,
        audience: new URL(options.publicUrl).origin,
      };
    },
  );
  app.post(
    "/api/node/register",
    {
      bodyLimit: 4096,
      config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
    },
    async (req) => {
      const { challenge, signature, authVersion, ...d } = registrationSchema
        .extend({
          authVersion: z.literal(nodeAuthVersion),
          challenge: nonceSchema,
          signature: z.string().max(128),
        })
        .parse(req.body);
      const issued = registrationChallenges.get(challenge);
      // 无论验签成功与否都消费挑战，失败必须重新申请。
      registrationChallenges.delete(challenge);
      const payloadDigest = registrationDigest(d);
      ensure(
        issued &&
          issued.expires > Date.now() &&
          issued.digest === payloadDigest,
        "CHALLENGE_INVALID",
        i18nMessage(
          "errors.CHALLENGE_INVALID.the.registration.challenge.is.invalid.or",
        ),
        403,
      );
      ensure(
        verify(
          null,
          Buffer.from(
            nodeProofText(
              options.publicUrl,
              "register",
              "",
              d.publicKey,
              payloadDigest,
              challenge,
            ),
          ),
          d.publicKey,
          Buffer.from(signature, "base64"),
        ),
        "SIGNATURE_INVALID",
        i18nMessage(
          "errors.SIGNATURE_INVALID.registration.signature.verification.failed",
        ),
        403,
      );
      return store.transaction(() => {
        const changed = store.db
          .prepare(
            "UPDATE invitations SET used=1 WHERE hash=? AND used=0 AND expires>?",
          )
          .run(digest(d.code), Date.now());
        ensure(
          changed.changes === 1,
          "INVITATION_INVALID",
          i18nMessage(
            "errors.INVITATION_INVALID.the.access.code.is.invalid.or",
          ),
          403,
        );
        return store.put("environments", {
          name: d.name,
          publicKey: d.publicKey,
          approved: false,
          revoked: false,
          roots: [],
          tools: {},
        });
      });
    },
  );
  app.post<{ Params: { id: string } }>(
    "/api/environments/:id/approve",
    async (req) =>
      store.put(
        "environments",
        { approved: true },
        store.get("environments", req.params.id).id,
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/environments/:id/revoke",
    async (req) => {
      const e = store.get("environments", req.params.id);
      store.put("environments", { revoked: true }, e.id);
      const peer = service.peers.get(e.id);
      const socket = nodeConnections.get(e.id);
      try {
        peer?.notify("identity.revoked", {});
      } catch {
        req.log.warn({ environmentId: e.id }, "撤销通知发送失败，继续关闭连接");
      } finally {
        // 先解除派发与连接引用，发送或关闭失败均不能留下可用 peer。
        service.peers.delete(e.id);
        nodeConnections.delete(e.id);
        try {
          peer?.close();
        } finally {
          socket?.close(4003, "identity revoked");
        }
      }
      return { ok: true };
    },
  );
  app.get(
    "/api/node/connect",
    {
      websocket: true,
      config: { rateLimit: { max: 60, timeWindow: "1 minute" } },
    },
    (socket, req) => {
      const challenge = token();
      const authenticationExpires = Date.now() + 15000;
      let environmentId = "";
      let consumed = false;
      let pong = true;
      const connectionId = randomUUID();
      let closeReason = "";
      let authenticationFailures = 0;
      let metricsTimer: NodeJS.Timeout | undefined;
      const log = (event: string, fields: any = {}) => {
        process.stdout.write(
          JSON.stringify({
            time: new Date().toISOString(),
            event,
            connectionId,
            environmentId: environmentId || null,
            ...fields,
          }) + "\n",
        );
      };
      const monitor = new ConnectionDiagnostics(log);
      log("connection.open");
      const deadline = setTimeout(() => {
        closeReason = "authentication_timeout";
        socket.close(4001, "authentication timeout");
      }, 15000);
      const heartbeat = setInterval(() => {
        if (!pong) {
          closeReason = "heartbeat_timeout";
          log("heartbeat.timeout", {
            ...monitor.snapshot(),
            initiator: "server",
            reason: closeReason,
            closeCode: 1006,
            closeReason,
          });
          clearInterval(heartbeat);
          socket.terminate();
          return;
        }
        pong = false;
        socket.ping(monitor.ping());
      }, 20000);
      socket.on("pong", (payload) => {
        monitor.pong(payload.toString());
        pong = true;
      });
      const peer = new RpcPeer(
        (data) => {
          if (socket.readyState === 1) socket.send(data);
          else
            throw new AppError(
              "OFFLINE",
              i18nMessage("errors.OFFLINE.the.connection.has.closed"),
            );
        },
        async (method, p) => {
          try {
            if (!environmentId) {
              ensure(
                method === "identity.authenticate" && !consumed,
                "UNAUTHENTICATED",
                i18nMessage(
                  "errors.UNAUTHENTICATED.authenticate.your.identity",
                ),
                401,
              );
              consumed = true;
              ensure(
                Date.now() < authenticationExpires,
                "CHALLENGE_EXPIRED",
                i18nMessage(
                  "errors.CHALLENGE_EXPIRED.connection.authentication.timed.out",
                ),
                401,
              );
              ensure(
                p?.authVersion === nodeAuthVersion,
                "AUTH_PROTOCOL",
                i18nMessage(
                  "errors.AUTH_PROTOCOL.upgrade.the.connector.to.use.the",
                ),
                403,
              );
              const d = z
                .object({
                  authVersion: z.literal(nodeAuthVersion),
                  environmentId: z.string().uuid(),
                  signature: z.string().max(128),
                  protocol: z.literal(1),
                  // 正式连接器同时声明看板引用与原生标题能力，保留有界的扩展空间。
                  capabilities: z.array(z.string().max(80)).max(32).optional(),
                  connectorVersion: connectorVersionSchema
                    .nullable()
                    .optional(),
                  connectorBuildId: z
                    .string()
                    .regex(/^[a-f0-9]{40}$/)
                    .nullable()
                    .optional(),
                  updateInstallation: z
                    .object({
                      current: z
                        .object({
                          updateProtocol: z.number().int().positive(),
                          dataFormat: z.number().int().positive(),
                          compatibility: z.unknown(),
                        })
                        .optional(),
                      managed: z.boolean(),
                      blockedReason: z.string().nullable(),
                    })
                    .optional(),
                  roots: z
                    .array(z.object({ id: z.string(), path: z.string() }))
                    .max(50),
                  tools: z.record(z.string(), z.unknown()),
                  platform: z.string(),
                })
                .parse(p);
              const e = store.get("environments", d.environmentId);
              ensure(
                !e.revoked,
                "REVOKED",
                i18nMessage("errors.REVOKED.the.identity.has.been.revoked"),
                403,
              );
              ensure(
                e.approved,
                "PENDING",
                i18nMessage("errors.PENDING.waiting.for.the.user.to.approve"),
                403,
              );
              ensure(
                verify(
                  null,
                  Buffer.from(
                    nodeProofText(
                      options.publicUrl,
                      "connect",
                      e.id,
                      e.publicKey,
                      "",
                      challenge,
                    ),
                  ),
                  e.publicKey,
                  Buffer.from(d.signature, "base64"),
                ),
                "SIGNATURE_INVALID",
                i18nMessage(
                  "errors.SIGNATURE_INVALID.signature.verification.failed",
                ),
                403,
              );
              ensure(
                !nodeConnections.has(e.id),
                "DUPLICATE_CONNECTION",
                i18nMessage(
                  "errors.DUPLICATE_CONNECTION.this.identity.is.already.connected",
                ),
                409,
              );
              nodeConnections.set(e.id, socket);
              environmentId = e.id;
              log("connection.authenticated", {
                connectorVersion: d.connectorVersion || null,
              });
              clearTimeout(deadline);
              store.put(
                "environments",
                {
                  capabilities: d.capabilities || [],
                  roots: d.roots,
                  tools: d.tools,
                  platform: d.platform,
                  // 旧连接器重新连接时清空旧值，不能沿用另一版客户端的历史上报。
                  connectorVersion: d.connectorVersion || null,
                  connectorBuildId: d.connectorBuildId || null,
                  updateInstallation: d.updateInstallation || null,
                  lastSeen: new Date().toISOString(),
                },
                e.id,
              );
              // 先完成状态对账，再将节点加入可派发集合。
              setTimeout(() => {
                void service
                  .reconcile(e.id, peer)
                  .then(async () => {
                    await connectorUpdates.reconcile(e.id, peer);
                    if (
                      socket.readyState === 1 &&
                      nodeConnections.get(e.id) === socket &&
                      !store.get("environments", e.id).revoked
                    ) {
                      service.peers.set(e.id, peer);
                      if (d.capabilities?.includes(metricsCapability)) {
                        metricsTimer = service.metrics.monitor(
                          e.id, peer,
                          () => service.peers.get(e.id) === peer && socket.readyState === 1 && !store.get("environments", e.id).revoked,
                          reason => log("environment.metrics_failed", { reason }),
                        );
                      }
                      service.sessionEvents.emit("environment:" + e.id, { type: "environment-ready" });
                      void service.syncSessionTitles(e.id, peer);
                    }
                  })
                  .catch(() => socket.close());
              }, 0);
              return { ok: true };
            }
            ensure(
              !store.get("environments", environmentId).revoked,
              "REVOKED",
              i18nMessage("errors.REVOKED.the.identity.has.been.revoked"),
            );
            if (method === "connector.update.report") {
              // 周期对账在任务状态恢复之后确认成功；通知只触发读取，避免信任乱序事件。
              void connectorUpdates
                .reconcile(environmentId, peer)
                .catch(() => {});
              return { ok: true };
            }
            if (method === "connector.update.grant")
              return connectorUpdates.issue(
                environmentId,
                idSchema.parse(p.operationId),
              );
            if (method.startsWith("board.")) return sessionBoards.agent(method.slice(6), environmentId, peer, p);
            if (["light.docs", "light.publish", "light.feedback", "light.versions", "light.publish.status", "light.unlist", "light.relist", "light.switchBackend", "light.delete"].includes(method))
              return await light.agent(method, environmentId, peer, p);
            if (method === "execution.event") {
              service.sessionEvent(environmentId, p);
              return { ok: true };
            }
            if (
              method === "workflow.handoff" ||
              method === "workflow.handoff.status"
            ) {
              const e = service.execution(p.executionId);
              ensure(
                e.environment_id === environmentId && e.item_id === p.itemId,
                "SCOPE",
                i18nMessage("errors.SCOPE.execution.ownership.does.not.match"),
                403,
              );
              if (method === "workflow.handoff.status")
                return artifacts.status(p.operationId, e.id, p.itemId);
              if (
                p.artifacts !== undefined &&
                (!Array.isArray(p.artifacts) || p.artifacts.length)
              )
                return artifacts.submit(p, peer);
              return service.submitHandoff(
                p.itemId,
                p.targetId,
                p.record,
                p.operationId,
                e.id,
              );
            }
            throw new AppError(
              "METHOD_NOT_FOUND",
              i18nMessage("errors.METHOD_NOT_FOUND.unsupported.method"),
            );
          } catch (error) {
            // 未认证连接只有十五秒寿命，首次失败独立记录，其余在关闭时汇总。
            if (!environmentId && ++authenticationFailures === 1)
              log("connection.authentication_failed", {
                reason:
                  error instanceof AppError &&
                  [
                    "PENDING",
                    "REVOKED",
                    "AUTH_PROTOCOL",
                    "SIGNATURE_INVALID",
                    "DUPLICATE_CONNECTION",
                    "CHALLENGE_EXPIRED",
                  ].includes(error.code)
                    ? error.code
                    : "AUTH_FAILED",
              });
            throw error;
          }
        },
      );
      socket.on("message", (raw) => void peer.receive(raw.toString()));
      socket.on("close", (code, reason) => {
        log("connection.close", {
          ...monitor.snapshot(),
          closeCode: code,
          closeReason: closeCategory(code, reason.toString()),
          reason: closeReason || closeCategory(code, reason.toString()),
          authenticationFailures,
          initiator: closeReason || code === 4003 ? "server" : "unknown",
        });
        clearInterval(metricsTimer);
        monitor.close();
        clearTimeout(deadline);
        clearInterval(heartbeat);
        if (nodeConnections.get(environmentId) === socket)
          nodeConnections.delete(environmentId);
        peer.close();
        if (service.peers.get(environmentId) === peer)
          service.peers.delete(environmentId);
      });
      peer.notify("identity.challenge", {
        challenge,
        protocol: protocolVersion,
        authVersion: nodeAuthVersion,
        audience: new URL(options.publicUrl).origin,
      });
    },
  );
  if (options.webDir && existsSync(options.webDir)) {
    // 安装入口按 Compose 提供的公开地址渲染，优先于静态模板路由。
    for (const [file, platform] of [
      ["install.sh", "linux"],
      ["install.ps1", "windows"],
    ] as const) {
      app.get("/" + file, async (_req, reply) => {
        reply.header("Cache-Control", "no-store");
        const release = readConnectorRelease(options.webDir);
        ensure(
          release,
          "RELEASE_UNAVAILABLE",
          i18nMessage(
            "errors.RELEASE_UNAVAILABLE.the.installation.package.is.currently.unavailable",
          ),
          503,
        );
        ensure(
          release.releases.some((item) => item.platform === platform),
          "RELEASE_UNAVAILABLE",
          i18nMessage(
            "errors.RELEASE_UNAVAILABLE.the.release.package.for.this.platform",
          ),
          503,
        );
        return reply
          .type("text/plain; charset=utf-8")
          .send(
            renderInstaller(
              readFileSync(join(options.webDir!, file), "utf8"),
              platform,
              options.publicUrl,
              release,
            ),
          );
      });
    }
    app.get<{ Params: { file: string }; Querystring: { grant?: string } }>(
      "/downloads/:file",
      async (req, reply) => {
        const file = req.params.file;
        reply
          .header("Cache-Control", "no-store")
          .header("Referrer-Policy", "no-referrer");
        if (file === "release.json") {
          const owner = digest(req.cookies.relay_session || "");
          ensure(
            store.db
              .prepare(
                "SELECT hash FROM auth_sessions WHERE hash=? AND expires>?",
              )
              .get(owner, Date.now()),
            "UNAUTHENTICATED",
            i18nMessage("errors.UNAUTHENTICATED.sign.in.first"),
            401,
          );
        } else {
          downloads.verify(req.query.grant, file);
          const release = readConnectorRelease(options.webDir);
          ensure(
            release?.releases.some(
              (item) => file === item.file || file === item.file + ".sha256",
            ),
            "DOWNLOAD_NOT_FOUND",
            i18nMessage(
              "errors.DOWNLOAD_NOT_FOUND.the.current.release.package.does.not",
            ),
            404,
          );
        }
        return reply.sendFile("downloads/" + file);
      },
    );
    await app.register(staticFiles, {
      root: resolve(options.webDir),
      // 静态通配路由不得作为下载授权的旁路，显式下载路由已完成凭证复核。
      allowedPath: (path, _root, req) =>
        !path.replaceAll("\\", "/").split("/").includes("downloads") ||
        req.routeOptions.url === "/downloads/:file",
    });
    app.setNotFoundHandler((req, reply) => {
      let path = req.url.split("?")[0];
      try {
        path = decodeURIComponent(path);
      } catch {
        return reply
          .code(400)
          .send(
            errorBody(
              new AppError("INVALID_URL", i18nMessage("errors.invalidUrl")),
              negotiateLocale(req.headers["accept-language"]),
            ),
          );
      }
      if (path.startsWith("/api/"))
        return reply
          .code(404)
          .send(
            errorBody(
              new AppError("NOT_FOUND", i18nMessage("errors.notFound")),
              negotiateLocale(req.headers["accept-language"]),
            ),
          );
      // 下载文件失效时禁止回退首页，避免下载器把 HTML 当作发行包。
      if (path === "/downloads" || path.startsWith("/downloads/"))
        return reply
          .code(404)
          .send(
            errorBody(
              new AppError(
                "DOWNLOAD_NOT_FOUND",
                i18nMessage("errors.downloadMissing"),
              ),
              negotiateLocale(req.headers["accept-language"]),
            ),
          );
      return reply.sendFile("index.html");
    });
  }
  const updateTimer = setInterval(() => {
    void connectorUpdates.poll();
  }, 2000);
  const timer = setInterval(() => {
    void service.tick().catch((error) => {
      // 不记录异常正文；调度入口及固定类别足以定位失败边界。
      console.error(
        JSON.stringify({
          time: new Date().toISOString(),
          event: "scheduler.tick_failed",
          reason:
            error instanceof AppError ? "BUSINESS_ERROR" : "INTERNAL_ERROR",
        }),
      );
    });
  }, 1000);
  app.addHook("onClose", async () => {
    clearInterval(artifactCleanup);
    clearInterval(updateTimer);
    files.close();
    await uploads.close();
    await artifacts.close();
    clearInterval(timer);
    for (const peer of service.peers.values()) peer.close();
    store.close();
  });
  return { app, store, service, workbench, artifacts, light, sessionBoards };
}
