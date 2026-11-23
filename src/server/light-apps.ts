import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { AppError, type Entity } from "../shared/contracts.js";
import { storageScript } from "./light-document.js";
import { message, translate } from "../shared/i18n.js";
import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { RpcPeer } from "../shared/rpc.js";
import type { Service } from "./service.js";
import type { FileTransfers } from "./file-transfers.js";
import { digest, token } from "./security.js";
import {
  lightCapability,
  lightError,
  publishRequest,
  parseLightInput,
  versionsQuery,
  docsQuery,
  lightSandbox,
  versionsCapability,
  lifecycleCapability,
  appTarget,
  mimeTypes,
  safeAsset,
  feedbackQuery,
} from "../shared/light-apps.js";

/** 环境会话与工作台共用发布顺序和按版本统计的反馈数。 */
export function lightVersionSummaries(
  store: Service["store"],
  appId: string,
  includeRuntimeErrors = false,
) {
  return store
    .findBy("lightVersions", "appId", appId)
    .sort((a, b) => a.number - b.number)
    .map((v) => ({
      versionId: v.id,
      number: v.number,
      publishedAt: v.createdAt,
      feedbackCount: store.findBy("lightFeedback", "versionId", v.id).length,
      ...(includeRuntimeErrors && {
        runtimeErrorCount: store.findBy("lightDiagnostics", "versionId", v.id)
          .reduce((total, error) => total + error.count, 0),
      }),
    }));
}

export interface LightConfig {
  domain: string;
  mainOrigin?: string;
  storageQuota?: number;
  hostUrl: string;
  key: string;
}
export function hostDomain(domain: string, publicUrl: string) {
  const main = new URL(publicUrl).hostname;
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(domain) &&
    main !== domain &&
    !main.endsWith("." + domain)
    ? domain
    : "";
}
type Grant = {
  versionId: string;
  login: string;
  epoch: number;
  expires: number;
  viewId: string;
  channelId: string;
  kind: "ticket" | "access" | "view";
};

// 版本索引本身就是会话卡片，和当前版本指针一起提交，不复制会话正文。
export class LightApps {
  readonly quota: number;
  private grants = new Map<string, Grant>();
  constructor(
    private service: Service,
    private files: FileTransfers,
    readonly config: LightConfig,
  ) {
    this.quota = z.coerce.number().int().positive()
      .parse(config.storageQuota ?? process.env.RELAY_LIGHT_STORAGE_QUOTA ?? 1048576);
  }
  private get store() {
    return this.service.store;
  }
  private async host(path: string, body?: unknown) {
    if (
      !this.config.domain ||
      this.config.key.length < 32 ||
      !this.config.hostUrl
    )
      lightError("LIGHT_HOST", 503);
    try {
      const r = await fetch(new URL(path, this.config.hostUrl), {
        method: body ? "PUT" : "GET",
        redirect: "error",
        headers: {
          authorization: "Bearer " + this.config.key,
          "content-type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) lightError("LIGHT_HOST", 503);
    } catch {
      lightError("LIGHT_HOST", 503);
    }
  }
  private source(
    environmentId: string,
    executionId: string,
    peer: RpcPeer,
    write: boolean,
    confirming = false,
  ) {
    const e = this.service.execution(executionId);
    const session = this.store.get("sessions", e.session_id);
    const env = this.store.get("environments", environmentId);
    if (!env.capabilities?.includes(lightCapability))
      lightError("LIGHT_UPGRADE", 409);
    if (
      this.service.peers.get(environmentId) !== peer ||
      !env.approved ||
      env.revoked ||
      e.environment_id !== environmentId ||
      session.environmentId !== environmentId ||
      (!["running", "waiting", "dispatching"].includes(e.state) &&
        !(
          confirming &&
          e.state === "completed" &&
          session.executionId === e.id
        ))
    )
      lightError("LIGHT_SCOPE", 403);
    let stagePermission: string | undefined;
    if (e.item_id) {
      const item = this.store.get("items", e.item_id);
      const board = this.store.get("boards", item.boardId);
      const stage = board.stages.find((s: any) => s.id === item.stageId);
      const snapshot = JSON.parse(e.snapshot).stage;
      if (
        item.archived ||
        item.executionId !== e.id ||
        board.projectId !== session.projectId ||
        !stage ||
        stage.type !== "agent" ||
        snapshot?.id !== stage.id ||
        (write && !(stage.allowArtifacts && snapshot.allowArtifacts))
      )
        lightError("LIGHT_SCOPE", 403);
      stagePermission = stage.permission ?? "ask";
    }
    return { session, e, stagePermission };
  }
  async agent(
    method: string,
    environmentId: string,
    peer: RpcPeer,
    raw: unknown,
  ) {
    const { executionId, args } = z
      .object({ executionId: z.uuid(), args: z.unknown() })
      .strict()
      .parse(raw);
    const lifecycle = method === "light.delete" || method === "light.unlist";
    const check = () =>
      this.source(
        environmentId,
        executionId,
        peer,
        lifecycle || method === "light.publish" || method === "light.docs",
      );
    const { session, e, stagePermission } = check();
    const hasRuntime = this.store.get("environments", environmentId).capabilities?.includes("light-apps-v4");
    if (method === "light.docs") {
      if (!hasRuntime) lightError("LIGHT_UPGRADE", 409);
      const { topic } = parseLightInput(docsQuery, args);
      const locale = JSON.parse(e.snapshot).locale ?? this.service.languageSettings().locale;
      return {
        topic,
        text: translate(locale, "light.docs." + topic, { quota: this.quota }),
        ...(topic === "runtime" || topic === "debugging" ? {
          csp: lightSandbox("https://RESOURCE-HOST/v/VERSION/_files/SLOT/", this.config.mainOrigin!),
        } : {}),
        ...(topic === "debugging" ? { storageScript, example:
          `installLightStorage({ entries: [], quota: ${this.quota} }, message => parent.postMessage(message, "https://LOCAL-HOST"), "https://LOCAL-RESOURCE-HOST/v/VERSION/_files/SLOT/");` } : {}),
      };
    }
    if (lifecycle) {
      if (
        !this.store
          .get("environments", environmentId)
          .capabilities?.includes(lifecycleCapability)
      )
        lightError("LIGHT_UPGRADE", 409);
      const { appId } = parseLightInput(appTarget, args);
      const app = this.store.get("lightApps", appId);
      if (
        app.sessionId !== session.id ||
        app.environmentId !== environmentId ||
        app.itemId !== e.item_id
      )
        lightError("LIGHT_SCOPE", 403);
      if (method === "light.delete" && app.deletion)
        return app.deletion === "deleted"
          ? { status: "alreadyDeleted", appId }
          : this.purge(app);
      this.available(app);
      if (method === "light.unlist") {
        if (!app.listed) return { status: "alreadyUnlisted", appId };
        const snapshot = JSON.parse(e.snapshot);
        if (
          session.permission === "full" &&
          (snapshot.permission ?? snapshot.stage?.permission) === "full" &&
          (!e.item_id || stagePermission === "full")
        )
          return this.unlist(app);
      }
      return this.prepare(
        app,
        method === "light.delete" ? "delete" : "unlist",
        executionId,
      );
    }
    if (method === "light.versions" || method === "light.publish.status") {
      if (
        !this.store
          .get("environments", environmentId)
          .capabilities?.includes(versionsCapability)
      )
        lightError("LIGHT_UPGRADE", 409);
      if (method === "light.publish.status") {
        const { operationId } = parseLightInput(
          z.object({ operationId: z.uuid() }).strict(),
          args,
        );
        const version = this.store.findBy(
          "lightVersions",
          "operationId",
          operationId,
        )[0];
        if (
          !version ||
          version.executionId !== executionId ||
          version.sessionId !== session.id
        )
          return null;
        this.available(this.store.get("lightApps", version.appId));
        return {
          appId: version.appId,
          versionId: version.id,
          number: version.number,
        };
      }
      const { appId } = parseLightInput(versionsQuery, args);
      const apps = this.store
        .findBy("lightApps", "sessionId", session.id)
        .filter(
          (app) =>
            !app.deletion &&
            app.environmentId === environmentId &&
            (!appId || app.id === appId),
        )
        .map((app) => ({
          appId: app.id,
          title: app.title,
          listed: app.listed,
          versions: lightVersionSummaries(this.store, app.id, hasRuntime),
        }));
      return { apps };
    }
    if (method === "light.feedback") {
      const { versionId } = parseLightInput(feedbackQuery, args);
      const v = this.store.get("lightVersions", versionId);
      if (v.sessionId !== session.id || v.environmentId !== environmentId)
        lightError("LIGHT_SCOPE", 403);
      this.available(this.store.get("lightApps", v.appId));
      return { feedback: this.feedback(versionId), ...(hasRuntime ? { runtimeErrors: this.errors(versionId) } : {}) };
    }
    const p = parseLightInput(publishRequest, args);
    if (!p.appId && !p.title)
      throw new AppError("LIGHT_INPUT", message("light.titleRequired"));
    const priorApp = () =>
      p.appId ? this.store.get("lightApps", p.appId) : undefined;
    const existing = priorApp();
    if (
      existing &&
      (existing.sessionId !== session.id ||
        existing.environmentId !== environmentId ||
        existing.itemId !== e.item_id)
    )
      lightError("LIGHT_SCOPE", 403);
    if (existing) this.available(existing);
    const fingerprint = digest(JSON.stringify([executionId, p]));
    const replay = () => {
      const v = this.store.findBy(
        "lightVersions",
        "operationId",
        p.operationId,
      )[0];
      if (v && v.executionId === executionId)
        this.available(this.store.get("lightApps", v.appId));
      if (v && v.fingerprint !== fingerprint) lightError("LIGHT_CONFLICT", 409);
      return v
        ? { appId: v.appId, versionId: v.id, number: v.number }
        : undefined;
    };
    const prior = replay();
    if (prior) return prior;
    if (
      p.directory !== "." &&
      !p.directory
        .split("/")
        .every(
          (part) =>
            /^[\p{L}\p{N}_-][\p{L}\p{N}_. -]*$/u.test(part) &&
            !/[. ]$/.test(part),
        )
    )
      throw new AppError("LIGHT_FILE", message("light.directory"));
    if (!safeAsset(p.entry) || !p.entry.endsWith(".html"))
      throw new AppError(
        "LIGHT_FILE",
        message("light.entry", { path: p.entry }),
      );
    const files = [...new Set([p.entry, ...(p.files || [])])];
    if (files.length > 128) lightError("LIGHT_LIMIT", 413);
    for (const path of files) {
      if (!Object.hasOwn(mimeTypes, extname(path).toLowerCase()))
        throw new AppError("LIGHT_FILE", message("light.extension", { path }));
      if (!safeAsset(path))
        throw new AppError("LIGHT_FILE", message("light.asset", { path }));
    }
    let total = 0;
    const assets: Record<string, string> = {};
    for (const path of files) {
      const fileFailure = (error: unknown): never => {
        if (
          error instanceof AppError &&
          (error.code.startsWith("FILE_") || error.code === "LIGHT_FILE")
        )
          throw new AppError(
            error.code,
            message("light.asset", { path }),
            error.status,
          );
        throw error;
      };
      const ticket = await this.files
        .create(executionId, {
          peer,
          revalidate: check,
          source: {
            rootId: session.rootId,
            relativePath: session.relativePath || ".",
            path: p.directory === "." ? path : p.directory + "/" + path,
            lightAsset: true,
          },
        })
        .catch(fileFailure);
      try {
        total += ticket.size;
        if (ticket.size > 8 * 1024 ** 2 || total > 32 * 1024 ** 2)
          lightError("LIGHT_LIMIT", 413);
        if (path === p.entry && !ticket.size)
          throw new AppError("LIGHT_FILE", message("light.entry", { path }));
        const parts: Buffer[] = [];
        for (let offset = 0; offset < ticket.size;) {
          const bytes = await this.files
            .read(executionId, ticket.id, offset)
            .catch(fileFailure);
          parts.push(bytes);
          offset += bytes.length;
        }
        const content = Buffer.concat(parts);
        if (
          /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----|(?:sk-proj-|sk-ant-|AKIA)[A-Za-z0-9_-]{16,}/.test(
            content.toString("latin1"),
          )
        )
          throw new AppError("LIGHT_FILE", message("light.asset", { path }));
        assets[path] = content.toString("base64");
      } finally {
        this.files.cancel(executionId, ticket.id);
      }
    }
    const versionId = randomUUID();
    const appId = existing?.id ?? randomUUID();
    await this.host("/internal/versions/" + versionId, { assets, appId });
    return this.store.transaction(() => {
      check();
      const previous = replay();
      if (previous) return previous;
      const app = priorApp();
      if (app) this.available(app);
      const number = (app?.number || 0) + 1;
      const source = {
        sessionId: session.id,
        environmentId,
        projectId: session.projectId,
        itemId: e.item_id,
      };
      const v = this.store.put(
        "lightVersions",
        {
          ...source,
          executionId,
          operationId: p.operationId,
          fingerprint,
          appId,
          number,
          title: p.title ?? app?.title,
          entry: p.entry,
        },
        versionId,
      );
      this.store.put(
        "lightApps",
        {
          ...source,
          title: p.title ?? app?.title,
          number,
          latestVersionId: v.id,
          publishedAt: v.createdAt,
          ...(!app ? { listed: true, epoch: 0 } : {}),
        },
        appId,
      );
      return { appId, versionId, number };
    });
  }
  private available(app: Entity) {
    if (app.deletion) lightError("LIGHT_DELETED", 410);
  }
  private unlist(app: Entity) {
    this.available(app);
    if (app.listed)
      this.store.put(
        "lightApps",
        { listed: false, epoch: app.epoch + 1 },
        app.id,
      );
    return {
      status: app.listed ? "unlisted" : "alreadyUnlisted",
      appId: app.id,
    };
  }
  private prepare(
    app: Entity,
    action: "delete" | "unlist",
    executionId?: string,
  ) {
    const same = this.store
      .findBy("lightConfirmations", "appId", app.id)
      .find(
        (c) =>
          c.action === action &&
          c.executionId === executionId &&
          c.latestVersionId === app.latestVersionId,
      );
    if (same) return same;
    const confirmation = this.store.put("lightConfirmations", {
      status: "pendingConfirmation",
      action,
      appId: app.id,
      title: app.title,
      sessionId: app.sessionId,
      executionId,
      latestVersionId: app.latestVersionId,
      versionCount: app.number,
    });
    if (executionId)
      this.service.sessionEvents.emit(app.sessionId, {
        type: "light-confirmation",
        appId: app.id,
      });
    return confirmation;
  }
  private async purge(app: Entity) {
    // 先持久撤销访问，再跨服务清理。中途失败可按原应用重复执行。
    if (!app.deletion)
      this.store.put(
        "lightApps",
        { listed: false, epoch: app.epoch + 1, deletion: "cleaning" },
        app.id,
      );
    const versions = this.store.findBy("lightVersions", "appId", app.id);
    try {
      // 分批兼容较早托管库的版本，限制内部请求正文大小。
      for (let i = 0; i < versions.length; i += 500)
        await this.host("/internal/apps/" + app.id + "/purge", {
          versionIds: versions.slice(i, i + 500).map((v) => v.id),
        });
      this.store.transaction(() => {
        for (const v of versions) {
          for (const kind of ["lightStorage", "lightDiagnostics"])
            for (const row of this.store.findBy(kind, "versionId", v.id))
              this.store.remove(kind, row.id);
          for (const feedback of this.store.findBy(
            "lightFeedback",
            "versionId",
            v.id,
          ))
            this.store.remove("lightFeedback", feedback.id);
        }
        this.store.put("lightApps", { deletion: "deleted" }, app.id);
        for (const c of this.store.findBy(
          "lightConfirmations",
          "appId",
          app.id,
        ))
          this.store.remove("lightConfirmations", c.id);
      });
      return { status: "deleted", appId: app.id };
    } catch (error) {
      if (this.store.get("lightApps", app.id).deletion === "deleted")
        return { status: "alreadyDeleted", appId: app.id };
      if (!(error instanceof AppError && error.code === "LIGHT_HOST"))
        throw error;
      return { status: "cleanupIncomplete", appId: app.id, code: error.code };
    }
  }
  private errors(versionId: string) {
    return this.store.findBy("lightDiagnostics", "versionId", versionId);
  }
  private checkView(id: string, viewId: string, cookie: string) {
    const v = this.store.get("lightVersions", id);
    const app = this.store.get("lightApps", v.appId);
    if (!app.listed) lightError("LIGHT_OFFLINE", 410);
    const view = this.grants.get(viewId);
    if (
      view?.kind !== "view" ||
      view.versionId !== id ||
      view.login !== digest(cookie) ||
      view.expires <= Date.now() ||
      view.epoch !== app.epoch
    )
      lightError("LIGHT_ACCESS", 401);
  }
  private feedback(versionId: string) {
    return this.store
      .list("lightFeedback")
      .filter((f) => f.versionId === versionId);
  }
  private issue(grant: Grant) {
    for (const [key, g] of this.grants)
      if (g.expires <= Date.now()) this.grants.delete(key);
    const raw = token();
    this.grants.set(digest(raw), grant);
    return raw;
  }
  authorize(raw: unknown) {
    const { versionId, credential, exchange, viewId } = z
      .object({
        versionId: z.uuid(),
        credential: z.string().min(1).max(256),
        exchange: z.boolean(),
        viewId: z.uuid().optional(),
      })
      .parse(raw);
    const key = digest(credential),
      g = this.grants.get(key);
    if (
      !g ||
      g.versionId !== versionId ||
      (viewId !== undefined && g.viewId !== viewId) ||
      g.expires <= Date.now() ||
      g.kind !== (exchange ? "ticket" : "access") ||
      !this.store.db
        .prepare("SELECT 1 FROM auth_sessions WHERE hash=? AND expires>?")
        .get(g.login, Date.now())
    )
      lightError("LIGHT_ACCESS", 401);
    const v = this.store.get("lightVersions", versionId),
      app = this.store.get("lightApps", v.appId);
    if (!app.listed) lightError("LIGHT_OFFLINE", 410);
    if (app.epoch !== g.epoch) lightError("LIGHT_ACCESS", 401);
    if (!exchange) return { entry: v.entry, channelId: g.channelId };
    this.grants.delete(key);
    this.grants.set(g.viewId, {
      ...g,
      kind: "view",
      expires: Date.now() + 3600000,
    });
    return {
      entry: v.entry,
      access: this.issue({
        ...g,
        kind: "access",
        expires: Date.now() + 3600000,
      }),
    };
  }
  register(app: FastifyInstance) {
    app.get("/api/light-apps", async (req) => {
      const { listed } = z
        .object({ listed: z.enum(["true", "false"]).default("true") })
        .parse(req.query);
      return this.store
        .list("lightApps")
        .filter(
          (a) => a.deletion !== "deleted" && a.listed === (listed === "true"),
        )
        .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
    });
    app.get("/api/light-versions", async (req) => {
      const q = z
        .object({
          sessionId: z.uuid().optional(),
          itemId: z.uuid().optional(),
          appId: z.uuid().optional(),
        })
        .strict()
        .parse(req.query);
      return this.store
        .list("lightVersions")
        .filter((v) => Object.entries(q).every(([k, val]) => v[k] === val))
        .map(({ fingerprint, operationId, ...v }) => {
          const app = this.store.get("lightApps", v.appId);
          if (app.deletion) {
            const {
              id,
              appId,
              sessionId,
              itemId,
              executionId,
              title,
              number,
              createdAt,
            } = v;
            return {
              id,
              appId,
              sessionId,
              itemId,
              executionId,
              title,
              number,
              createdAt,
              listed: false,
              deletion: app.deletion,
              feedback: [],
            };
          }
          return { ...v, listed: app.listed, feedback: this.feedback(v.id) };
        });
    });
    app.post("/api/light-apps/:id/delete-request", async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const app = this.store.get("lightApps", id);
      if (app.deletion === "deleted")
        return { status: "alreadyDeleted", appId: id };
      return this.prepare(app, "delete");
    });
    app.get("/api/light-confirmations", async (req) => {
      const { sessionId } = z.object({ sessionId: z.uuid() }).parse(req.query);
      return this.store
        .findBy("lightConfirmations", "sessionId", sessionId)
        .filter((c) => c.executionId);
    });
    app.post("/api/light-apps/:id/decision", async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { confirmationId, approve } = z
        .object({ confirmationId: z.uuid(), approve: z.boolean() })
        .strict()
        .parse(req.body);
      const app = this.store.get("lightApps", id);
      if (app.deletion === "deleted")
        return { status: "alreadyDeleted", appId: id };
      const c = this.store.get("lightConfirmations", confirmationId);
      if (c.appId !== id) lightError("LIGHT_SCOPE", 403);
      if (!approve && app.deletion === "cleaning")
        return { status: "cleanupIncomplete", appId: id };
      if (!approve) {
        this.store.remove("lightConfirmations", c.id);
        return { status: "cancelled", appId: id };
      }
      if (c.executionId) {
        const peer = this.service.peers.get(app.environmentId);
        if (!peer) lightError("LIGHT_SCOPE", 403);
        const { session, e } = this.source(
          app.environmentId,
          c.executionId,
          peer,
          true,
          true,
        );
        if (session.id !== app.sessionId || e.item_id !== app.itemId)
          lightError("LIGHT_SCOPE", 403);
      }
      // 版本只追加，末版 UUID 唯一标识确认时包含的完整版本集合。
      if (c.latestVersionId !== app.latestVersionId) {
        this.store.remove("lightConfirmations", c.id);
        if (c.executionId) this.prepare(app, c.action, c.executionId);
        lightError("LIGHT_SCOPE_CHANGED", 409);
      }
      if (c.action === "unlist") {
        this.store.remove("lightConfirmations", c.id);
        return this.unlist(app);
      }
      return this.purge(app);
    });
    app.put("/api/light-apps/:id/listing", async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params),
        { listed } = z.object({ listed: z.boolean() }).strict().parse(req.body);
      const app = this.store.get("lightApps", id);
      this.available(app);
      return app.listed === listed
        ? app
        : this.store.put("lightApps", { listed, epoch: app.epoch + 1 }, id);
    });
    app.post("/api/light-versions/:id/open", async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const v = this.store.get("lightVersions", id);
      if (!this.store.get("lightApps", v.appId).listed)
        lightError("LIGHT_OFFLINE", 410);
      await this.host("/internal/versions/" + id);
      const app = this.store.get("lightApps", v.appId);
      if (!app.listed) lightError("LIGHT_OFFLINE", 410);
      const viewId = randomUUID();
      const channelId = randomUUID();
      return {
        viewId,
        channelId,
        action: "https://" + this.config.domain + "/v/" + id + "/_open",
        ticket: this.issue({
          versionId: id,
          viewId,
          channelId,
          epoch: app.epoch,
          login: digest(req.cookies.relay_session!),
          kind: "ticket",
          expires: Date.now() + 60000,
        }),
      };
    });
    app.post("/api/light-versions/:id/close", async (req, reply) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { viewId } = z
        .object({ viewId: z.uuid() })
        .strict()
        .parse(req.body);
      const login = digest(req.cookies.relay_session!);
      for (const [key, grant] of this.grants)
        if (
          grant.viewId === viewId &&
          grant.versionId === id &&
          grant.login === login
        )
          this.grants.delete(key);
      return reply.code(204).send();
    });
    const runtimeBody = z.object({ viewId: z.uuid() });
    const runtimeId = z.object({ id: z.uuid() });
    app.post("/api/light-versions/:id/snapshot", async (req) => {
      const { id } = runtimeId.parse(req.params);
      const { viewId } = runtimeBody.strict().parse(req.body);
      this.checkView(id, viewId, req.cookies.relay_session!);
      const row = this.store.findBy("lightStorage", "versionId", id)[0];
      return { entries: row?.entries ?? [], quota: this.quota };
    });
    app.post("/api/light-versions/:id/storage", async (req, reply) => {
      const { id } = runtimeId.parse(req.params);
      const { viewId, changes } = runtimeBody.extend({
        changes: z.array(z.tuple([z.string(), z.string().nullable()])),
      }).strict().parse(req.body);
      this.checkView(id, viewId, req.cookies.relay_session!);
      // 只合并本次修改的键，保留其他视图对不同键的提交。
      this.store.transaction(() => {
        const row = this.store.findBy("lightStorage", "versionId", id)[0];
        const values = new Map<string, string>(row?.entries);
        for (const [key, value] of changes) {
          if (value === null) values.delete(key);
          else values.set(key, value);
        }
        let size = 0;
        for (const [key, value] of values) size += key.length + value.length;
        if (size > this.quota) throw new AppError("LIGHT_QUOTA", message("errors.LIGHT_QUOTA.storage"), 413);
        this.store.put("lightStorage", { versionId: id, entries: [...values] }, row?.id);
      });
      return reply.code(204).send();
    });
    app.post("/api/light-versions/:id/diagnostics", async (req, reply) => {
      const { id } = runtimeId.parse(req.params);
      const { viewId, error } = runtimeBody.extend({
        error: z.object({
          kind: z.enum(["script", "resource", "promise", "storage"]),
          message: z.string().max(512),
          file: z.string().max(512),
          line: z.number().int().nonnegative(),
          column: z.number().int().nonnegative(),
        }).strict(),
      }).strict().parse(req.body);
      this.checkView(id, viewId, req.cookies.relay_session!);
      if (error.kind === "storage") {
        error.message = error.message === "QuotaExceededError" ? error.message : "Storage commit failed";
        error.file = "";
      }
      this.store.transaction(() => {
        const errors = this.errors(id);
        const same = errors.find(row => Object.entries(error).every(([key, value]) => row[key] === value));
        if (!same && errors.length >= 64) return;
        this.store.put("lightDiagnostics", { versionId: id, ...error, count: (same?.count ?? 0) + 1 }, same?.id);
      });
      return reply.code(204).send();
    });
    app.post("/api/light-versions/:id/feedback", async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const data = z
        .object({
          viewId: z.uuid(),
          kind: z.enum(["confirmed", "change", "selection"]),
          text: z.string().trim().max(4000).default(""),
        })
        .strict()
        .parse(req.body);
      this.checkView(id, data.viewId, req.cookies.relay_session!);
      if (data.kind !== "confirmed" && !data.text)
        lightError("LIGHT_FILE", 400);
      return this.store.put("lightFeedback", {
        versionId: id,
        kind: data.kind,
        text: data.text,
      });
    });
    app.post(
      "/api/node/light-access",
      { config: { rateLimit: false } },
      async (req) => this.authorize(req.body),
    );
  }
}
