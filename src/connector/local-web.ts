import { negotiateLocale, translate, type Locale } from "../shared/i18n.js";
import { errorBody } from "../shared/i18n-errors.js";
import { message as i18nMessage } from "../shared/i18n.js";
import { assertNotUpdating } from "./update-installation.js";
import { z } from "zod";
import { claudeSupportStatus, installClaudeSupport } from "./claude-support.js";
import type { MessageKey } from "../shared/i18n.js";
import { probeCli } from "./host-cli.js";
import Fastify from "fastify";
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { token } from "../server/security.js";
import { ensure } from "../shared/contracts.js";
import { ConnectorConfig } from "./config.js";
import { workerStatus, startWorker, stopWorker } from "./process.js";
import { modelTools } from "./model-tools.js";
import { consoleHtml } from "./console-ui.js";
/** 本地控制页面仅监听回环地址，凭据通过 fragment 传入，不进入请求日志。 */
export async function startWeb(
  settings: ConnectorConfig,
  open: boolean,
  locale: Locale = "en",
) {
  const secret = token(),
    app = Fastify({ logger: false, bodyLimit: 65536 });
  const shutdown = () => void app.close();
  app.addHook("onClose", async () => {
    for (const signal of ["SIGINT", "SIGTERM"] as const)
      process.removeListener(signal, shutdown);
  });
  let origin = "";
  app.addHook("onRequest", async (req, reply) => {
    reply
      .header(
        "Content-Language",
        negotiateLocale(req.headers["accept-language"]),
      )
      .header("Vary", "Accept-Language")
      .header("Cache-Control", "no-store")
      .header("X-Frame-Options", "DENY");
    ensure(
      req.headers.host === new URL(origin).host,
      "HOST_DENIED",
      i18nMessage("errors.HOST_DENIED.invalid.access.host"),
    );
    // 使用已匹配路由，编码路径同样必须验证本机控制令牌。
    if ((req.routeOptions.url || req.url).startsWith("/api/"))
      ensure(
        req.headers.authorization === `Bearer ${secret}`,
        "AUTH_REQUIRED",
        i18nMessage("errors.AUTH_REQUIRED.use.the.complete.link.displayed.at"),
      );
    if (req.method === "POST")
      ensure(
        req.headers.origin === origin,
        "ORIGIN_DENIED",
        i18nMessage("errors.ORIGIN_DENIED.invalid.request.origin"),
      );
  });
  app.setErrorHandler((error, req, reply) =>
    reply
      .code(400)
      .send(errorBody(error, negotiateLocale(req.headers["accept-language"]))),
  );
  app.get("/", async (_req, reply) =>
    reply.type("text/html; charset=utf-8").send(consoleHtml),
  );
  app.get("/assets/brand.png", async (_req, reply) =>
    reply
      .type("image/png")
      .send(
        readFileSync(
          new URL(
            "../web/assets/bugpaw-app-icon-brown-paw.png",
            import.meta.url,
          ),
        ),
      ),
  );
  // 只更新下次启动要用的模式与路径，正在运行的客户端继续持有创建时的配置。
  app.post("/api/claude/mode", async (req) => {
    const patch = z.object({
      mode: z.enum(["environment", "custom"]), command: z.string().optional(),
    }).strict().parse(req.body);
    settings.saveClaudeMode(patch);
    return { ok: true };
  });
  let step: MessageKey | null = null;
  app.get("/api/claude/support", async () => ({
    ...await claudeSupportStatus(settings.dir, settings.read().claude), step,
  }));
  // 安装期间仅查询步骤，避免每次轮询重复运行 CLI 版本命令。
  app.get("/api/claude/support/progress", async () => ({ step }));
  app.post("/api/claude/support/install", async (req) => {
    const { expected } = z.object({
      expected: z.object({
        mode: z.enum(["environment", "custom"]),
        command: z.string(),
        components: z.array(z.enum(["cli", "sdk"])).max(2),
      }).strict().optional(),
    }).strict().parse(req.body ?? {});
    assertNotUpdating();
    ensure(!step, "CLAUDE_INSTALL_BUSY", i18nMessage("connector.support.busy"));
    const config = settings.read().claude;
    ensure(
      !expected || (expected.mode === config.mode && expected.command === (config.command?.trim() || "claude")),
      "CLAUDE_PLAN_CHANGED",
      i18nMessage("console.claudeSupportChanged"),
    );
    step = "connector.support.check";
    try {
      return await installClaudeSupport(settings.dir, config, key => { step = key; }, expected?.components);
    } finally {
      step = null;
    }
  });
  app.post("/api/claude/check", async (req) => {
    const { command } = z.object({ command: z.string().optional() }).strict().parse(req.body);
    return probeCli("claude", { command: command ?? settings.read().claude.command, mode: "environment" });
  });
  app.post("/api/models", async (req) =>
    modelTools(settings, req.body, "models"),
  );
  app.post("/api/test-connection", async (req) =>
    modelTools(settings, req.body, "test"),
  );
  app.get("/api/config", async () => settings.public());
  app.get("/api/status", async (req) => ({
    ...(await workerStatus(
      settings,
      negotiateLocale(req.headers["accept-language"]),
    )),
    registered: !!settings.read().environmentId,
  }));
  async function editable() {
    ensure(
      !(await workerStatus(settings)).running,
      "RUNNING",
      i18nMessage("errors.RUNNING.stop.the.connector.before.changing.its"),
    );
  }
  app.post("/api/config", async (req) => {
    await editable();
    settings.update(req.body);
    return { ok: true };
  });
  app.post("/api/register", async (req) => {
    await editable();
    await settings.register(
      String((req.body as any)?.code || ""),
      negotiateLocale(req.headers["accept-language"]),
    );
    await startWorker(settings);
    return { ok: true };
  });
  app.post("/api/start", async (req) =>
    startWorker(settings, negotiateLocale(req.headers["accept-language"])),
  );
  app.post("/api/stop", async (req) => {
    assertNotUpdating();
    return stopWorker(
      settings,
      negotiateLocale(req.headers["accept-language"]),
    );
  });
  // localStorage 按端口隔离；复用本机端口，让重启控制台后仍能恢复皮肤。
  const portFile = join(settings.dir, "console-port");
  let port = 0;
  try {
    const previous = Number(readFileSync(portFile, "utf8"));
    if (Number.isInteger(previous) && previous >= 1024 && previous <= 65535)
      port = previous;
  } catch {
    // 首次运行没有端口记录，交由系统分配。
  }
  try {
    await app.listen({ host: "127.0.0.1", port });
  } catch (error) {
    if (!port || (error as NodeJS.ErrnoException).code !== "EADDRINUSE")
      throw error;
    // 端口被其他进程占用时分配新端口，不终止或接管已有服务。
    await app.listen({ host: "127.0.0.1", port: 0 });
  }
  writeFileSync(portFile, String((app.server.address() as any).port), {
    mode: 0o600,
  });
  origin = `http://127.0.0.1:${(app.server.address() as any).port}`;
  const url = origin + "/#" + secret;
  console.log(translate(locale, "cli.web.url", { url }));
  if (settings.read().environmentId)
    await startWorker(settings).catch((e) =>
      console.error(errorBody(e, locale).message),
    );
  if (open) {
    const command = process.platform === "win32" ? "rundll32.exe" : "xdg-open";
    if (
      process.platform === "win32" ||
      process.env.DISPLAY ||
      process.env.WAYLAND_DISPLAY
    ) {
      const child = spawn(
        command,
        process.platform === "win32"
          ? ["url.dll,FileProtocolHandler", url]
          : [url],
        { stdio: "ignore", detached: true },
      );
      child.on("error", () => console.log(translate(locale, "cli.web.open")));
      child.unref();
    }
  }
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.once(signal, shutdown);
  return { app, url };
}
