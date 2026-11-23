import { lightSandbox } from "../shared/light-apps.js";
import Fastify from "fastify";
import cookie from "@fastify/cookie";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { digest } from "./security.js";
import { dirname, extname, posix } from "node:path";
import { z } from "zod";
import { safeAsset, mimeTypes, lightError } from "../shared/light-apps.js";
import { renderLightDocument } from "./light-document.js";
import { hostDomain } from "./light-apps.js";
import { AppError } from "../shared/contracts.js";
import { errorBody } from "../shared/i18n-errors.js";
import { negotiateLocale } from "../shared/i18n.js";

export async function createLightHost(options: {
  database: string;
  domain: string;
  mainOrigin: string;
  mainUrl: string;
  key: string;
}) {
  const origin = new URL(options.mainOrigin).origin,
    domain = hostDomain(options.domain, origin);
  if (!domain || options.key.length < 32) lightError("LIGHT_HOST", 503);
  mkdirSync(dirname(options.database), { recursive: true });
  const db = new DatabaseSync(options.database);
  db.exec(
    "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS assets(version TEXT,path TEXT,bytes BLOB NOT NULL,PRIMARY KEY(version,path))",
  );
  // 版本归属覆盖尚未写入主站索引的并发上传，删除标记阻止迟到的上传。
  db.exec(`CREATE TABLE IF NOT EXISTS version_apps(version TEXT PRIMARY KEY, app TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS versions_by_app ON version_apps(app);
    CREATE TABLE IF NOT EXISTS deleted_apps(app TEXT PRIMARY KEY)`);
  const app = Fastify({ logger: false });
  const internal = Fastify({ logger: false });
  await app.register(cookie);
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) =>
      done(null, Object.fromEntries(new URLSearchParams(String(body)))),
  );
  internal.addHook("onClose", async () => db.close());
  app.addHook("onRequest", async (req, reply) => {
    reply.headers({
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "content-security-policy":
        "sandbox; default-src 'none'; frame-ancestors " + origin,
    });
    if (req.hostname.toLowerCase() !== domain) lightError("LIGHT_ACCESS", 401);
  });
  internal.addHook("onRequest", async (req) => {
    if (
      req.routeOptions.url?.startsWith("/internal/") &&
      (req.headers.authorization !== "Bearer " + options.key ||
        req.headers.origin)
    )
      lightError("LIGHT_SCOPE", 403);
  });
  for (const listener of [app, internal])
    listener.setErrorHandler((err, req, reply) =>
      reply
        .code(
          err instanceof AppError
            ? err.status
            : err instanceof z.ZodError
              ? 400
              : 503,
        )
        .send(errorBody(err, negotiateLocale(req.headers["accept-language"]))),
    );
  internal.get("/api/health", async () => ({ ok: true }));
  internal.put(
    "/internal/versions/:id",
    { bodyLimit: 46 * 1024 ** 2 },
    async (req) => {
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      const { assets, appId } = z
        .object({
          assets: z.record(z.string(), z.string()),
          appId: z.uuid().optional(),
        })
        .parse(req.body);
      const entries = Object.entries(assets);
      if (!entries.length || entries.length > 128)
        lightError("LIGHT_LIMIT", 413);
      // 单事务提交完整版本；写入中断不会留下半包。
      db.exec("BEGIN IMMEDIATE");
      try {
        if (appId) {
          if (db.prepare("SELECT 1 FROM deleted_apps WHERE app=?").get(appId))
            lightError("LIGHT_DELETED", 410);
          db.prepare("INSERT INTO version_apps VALUES(?,?)").run(id, appId);
        }
        let total = 0;
        const insert = db.prepare("INSERT INTO assets VALUES(?,?,?)");
        for (const [path, encoded] of entries) {
          if (!safeAsset(path)) lightError("LIGHT_FILE", 400);
          const bytes = Buffer.from(encoded, "base64");
          total += bytes.length;
          if (bytes.length > 8 * 1024 ** 2 || total > 32 * 1024 ** 2)
            lightError("LIGHT_LIMIT", 413);
          insert.run(id, path, bytes);
        }
        db.exec("COMMIT");
      } catch (err) {
        db.exec("ROLLBACK");
        throw err;
      }
      return { ok: true };
    },
  );
  internal.put("/internal/apps/:id/purge", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const { versionIds } = z
      .object({ versionIds: z.array(z.uuid()) })
      .parse(req.body);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare("INSERT OR IGNORE INTO deleted_apps VALUES(?)").run(id);
      db.prepare(
        "DELETE FROM assets WHERE version IN (SELECT version FROM version_apps WHERE app=?)",
      ).run(id);
      db.prepare("DELETE FROM version_apps WHERE app=?").run(id);
      // 旧版上传仅以版本标识存储，由主站提供已确认的历史版本。
      const remove = db.prepare("DELETE FROM assets WHERE version=?");
      for (const versionId of versionIds) remove.run(versionId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { ok: true };
  });
  internal.get("/internal/versions/:id", async (req) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    if (!db.prepare("SELECT 1 FROM assets WHERE version=? LIMIT 1").get(id))
      lightError("LIGHT_HOST", 503);
    return { ok: true };
  });
  async function authorize(
    versionId: string,
    credential: string,
    exchange: boolean,
    viewId?: string,
  ) {
    if (!z.uuid().safeParse(versionId).success || !credential)
      lightError("LIGHT_ACCESS", 401);
    let response: Response;
    try {
      response = await fetch(
        new URL("/api/node/light-access", options.mainUrl),
        {
          method: "POST",
          redirect: "error",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ versionId, credential, exchange, viewId }),
          signal: AbortSignal.timeout(5000),
        },
      );
    } catch {
      lightError("LIGHT_HOST", 503);
    }
    if (response.status === 410) lightError("LIGHT_OFFLINE", 410);
    if (response.status >= 500) lightError("LIGHT_HOST", 503);
    if (!response.ok) lightError("LIGHT_ACCESS", 401);
    return {
      versionId,
      ...z
        .object({
          entry: z.string(),
          channelId: z.uuid().optional(),
          access: z.string().optional(),
        })
        .parse(await response.json()),
    };
  }
  app.post<{ Params: { id: string } }>(
    "/v/:id/_open",
    { bodyLimit: 1024 },
    async (req, reply) => {
      if (req.headers.origin !== origin) lightError("LIGHT_SCOPE", 403);
      const { ticket } = z.object({ ticket: z.string() }).parse(req.body);
      const g = await authorize(req.params.id, ticket, true);
      reply.setCookie("__Secure-light", g.access!, {
        secure: true,
        httpOnly: true,
        path: "/v/" + g.versionId + "/",
        sameSite: "none",
        partitioned: true,
        maxAge: 3600,
      });
      reply.header("referrer-policy", "strict-origin-when-cross-origin");
      return reply.redirect("/v/" + g.versionId + "/", 303);
    },
  );
  // 仅宿主可查询刚打开的视图，确认浏览器实际收到了分区 Cookie。
  app.post<{ Params: { id: string } }>("/v/:id/_status", async (req, reply) => {
    if (req.headers.origin !== origin) lightError("LIGHT_SCOPE", 403);
    reply.headers({
      "access-control-allow-origin": origin,
      "access-control-allow-credentials": "true",
      vary: "Origin",
    });
    const { viewId } = z.object({ viewId: z.uuid() }).parse(req.body);
    const { versionId, entry } = await authorize(
      req.params.id,
      req.cookies["__Secure-light"] || "",
      false,
      viewId,
    );
    if (
      !db
        .prepare("SELECT 1 FROM assets WHERE version=? AND path=?")
        .get(versionId, entry)
    )
      lightError("LIGHT_HOST", 503);
    return reply.code(204).send();
  });
  type VersionRoute = { Params: { id: string; "*": string } };
  const seeds = new Map<
    string,
    { access: string; id: string; expires: number }
  >();
  function seed(id: string, access: string) {
    for (const [key, value] of seeds)
      if (value.expires <= Date.now()) seeds.delete(key);
    const key = randomUUID();
    seeds.set(key, { id, access, expires: Date.now() + 60000 });
    return key;
  }
  function resourceBase(id: string, access: string) {
    return "/v/" + id + "/_files/" + digest("light-files:" + access) + "/";
  }
  function assetBytes(id: string, path: string) {
    if (!safeAsset(path)) lightError("LIGHT_FILE", 404);
    const row = db
      .prepare("SELECT bytes FROM assets WHERE version=? AND path=?")
      .get(id, path);
    if (!row) lightError("LIGHT_FILE", 404);
    return Buffer.from(row.bytes as Uint8Array);
  }
  // 不透明文档具有独立的分区上下文。一次性正文票据只在发布脚本运行前使用。
  app.post<{ Params: { id: string; slot: string } }>(
    "/v/:id/_files/:slot/_session",
    async (req, reply) => {
      const { id, slot } = req.params;
      if (req.headers.origin !== "null") lightError("LIGHT_SCOPE", 403);
      reply.headers({
        "access-control-allow-origin": "null",
        "access-control-allow-credentials": "true",
      });
      const { ticket } = z.object({ ticket: z.uuid() }).parse(req.body);
      const grant = seeds.get(ticket);
      seeds.delete(ticket);
      if (
        !grant ||
        grant.id !== id ||
        grant.expires <= Date.now() ||
        digest("light-files:" + grant.access) !== slot
      )
        lightError("LIGHT_ACCESS", 401);
      await authorize(id, grant.access, false);
      reply.setCookie("__Secure-light-files", grant.access, {
        path: resourceBase(id, grant.access),
        secure: true,
        httpOnly: true,
        partitioned: true,
        sameSite: "none",
        maxAge: 3600,
      });
      return reply.code(204).send();
    },
  );
  app.get<{ Params: { id: string; slot: string; "*": string } }>(
    "/v/:id/_files/:slot/*",
    async (req, reply) => {
      const { id, slot, "*": path } = req.params;
      const access = req.cookies["__Secure-light-files"] || "";
      if (!access || slot !== digest("light-files:" + access))
        lightError("LIGHT_ACCESS", 401);
      if (
        req.headers["service-worker"] ||
        req.headers["sec-fetch-mode"] === "navigate"
      )
        lightError("LIGHT_SCOPE", 403);
      await authorize(id, access, false);
      const prefix = "https://" + domain + resourceBase(id, access);
      reply.headers({
        "content-security-policy": lightSandbox(prefix, origin),
        "access-control-allow-origin": "null",
        "access-control-allow-credentials": "true",
      });
      if (path === "_ready") return reply.code(204).send();
      const bytes = assetBytes(id, path);
      const mime = mimeTypes[extname(path).toLowerCase()];
      // CSS 字体请求按标准省略跨源凭据，在已鉴权的样式响应中交付本版字体。
      if (mime === "text/css") {
        let size = bytes.length;
        const css = bytes
          .toString("utf8")
          .replace(
            /url\(\s*(['"]?)([^()'"]+?\.(?:woff2?|ttf)(?:[?#][^)'"]*)?)\1\s*\)/gi,
            (original, _quote: string, url: string) => {
              const font = new URL(url, prefix + path);
              if (!font.href.startsWith(prefix)) return original;
              const fontPath = decodeURIComponent(
                font.pathname.slice(new URL(prefix).pathname.length),
              );
              const data = assetBytes(id, fontPath);
              size += Math.ceil(data.length / 3) * 4;
              if (size > 64 * 1024 ** 2) lightError("LIGHT_LIMIT", 413);
              return (
                'url("data:' +
                mimeTypes[extname(fontPath).toLowerCase()] +
                ";base64," +
                data.toString("base64") +
                '")'
              );
            },
          );
        return reply.type(mime).send(css);
      }
      return reply.type(mime).send(bytes);
    },
  );
  app.get<VersionRoute>("/v/:id/*", async (req, reply) => {
    const { id, "*": asset } = req.params;
    const access = req.cookies["__Secure-light"] || "";
    const { entry, channelId } = await authorize(id, access, false);
    // 版本入口只接受地址栏或主站导航，禁止其他应用替换当前查看器的文档。
    if (
      req.headers["sec-fetch-mode"] !== "navigate" ||
      !(
        req.headers["sec-fetch-site"] === "none" ||
        req.headers.referer === origin + "/"
      )
    )
      lightError("LIGHT_SCOPE", 403);
    const path = asset || entry;
    const bytes = assetBytes(id, path);
    const prefix = "https://" + domain + resourceBase(id, access);
    reply.header("content-security-policy", lightSandbox(prefix, origin));
    const mime = mimeTypes[extname(path).toLowerCase()];
    if (mime !== "text/html") return reply.type(mime).send(bytes);
    const directory = posix.dirname(path);
    const base =
      prefix +
      (directory === "."
        ? ""
        : directory.split("/").map(encodeURIComponent).join("/") + "/");
    return reply.type("text/html; charset=utf-8").send(
      renderLightDocument({
        entry: path,
        base,
        prefix,
        mainOrigin: origin,
        channelId: z.uuid().parse(channelId),
        ticket: seed(id, access),
        html: bytes.toString("base64"),
      }),
    );
  });
  return { app, internal };
}
