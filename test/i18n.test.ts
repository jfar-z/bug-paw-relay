import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { z } from "zod";
import {
  messages,
  normalizeLocale,
  resolveLocale,
  negotiateLocale,
  translate,
  message,
} from "../src/shared/i18n.js";
import { AppError } from "../src/shared/contracts.js";
import { errorBody, localizeError } from "../src/shared/i18n-errors.js";
import {
  parseLanguageArgs,
  readLocalePreference,
  saveLocalePreference,
  systemLocale,
} from "../src/connector/locale.js";
import { digest } from "../src/server/security.js";
import { createApp } from "../src/server/app.js";
import { ConnectorConfig } from "../src/connector/config.js";
import { startWeb } from "../src/connector/local-web.js";
import { RpcPeer } from "../src/shared/rpc.js";

/** 发行资源必须双语齐全，参数不漂移，正常路径不能依赖缺键回退。 */
test("I18N 资源键、空文案及命名参数一致性", () => {
  for (const [key, value] of Object.entries(messages)) {
    assert.deepEqual(Object.keys(value).sort(), ["en", "zh-CN"]);
    assert.ok(value.en.trim() && value["zh-CN"].trim(), key);
    const params = (text: string) =>
      [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    assert.deepEqual(params(value.en), params(value["zh-CN"]), key);
    assert.doesNotMatch(value.en, /[\p{Script=Han}]/u, key);
  }
  assert.equal(translate("en", "missing.key"), messages["common.failure"].en);
});

test("系统语言、语言列表及 HTTP q 协商", () => {
  for (const tag of ["zh", "ZH_tw", "zh-Hans", "zh_CN.UTF-8@variant"])
    assert.equal(normalizeLocale(tag), "zh-CN");
  for (const tag of ["en-GB", "en_US.UTF-8", "C", "POSIX"])
    assert.equal(normalizeLocale(tag), "en");
  assert.equal(normalizeLocale("english"), undefined);
  assert.equal(resolveLocale("auto", ["fr-FR", "en-US", "zh-CN"]), "en");
  assert.equal(resolveLocale("zh-CN", ["en-US"]), "zh-CN");
  assert.equal(negotiateLocale("zh-CN;q=0,en;q=0.5"), "en");
  assert.equal(negotiateLocale("en;q=0.1,zh-TW;q=0.9"), "zh-CN");
  assert.equal(negotiateLocale("en;q=oops,zh;q=0.6"), "zh-CN");
  assert.equal(negotiateLocale("fr,*;q=0.5"), "en");
  assert.equal(
    systemLocale({ LC_ALL: "C", LANG: "zh_CN.UTF-8" }, "zh-TW"),
    "en",
  );
  assert.equal(
    systemLocale({ LC_MESSAGES: "zh_CN.UTF-8", LANG: "en" }, "en"),
    "zh-CN",
  );
  assert.equal(systemLocale({}, "zh-TW"), "zh-CN");
  assert.equal(systemLocale({ LANG: "fr_FR" }, "zh-CN"), "en");
});

test("CLI 全局参数不改变命令与机器字段", () => {
  assert.deepEqual(parseLanguageArgs(["--cli", "status", "--lang", "en"]), {
    args: ["--cli", "status"],
    override: "en",
  });
  assert.deepEqual(parseLanguageArgs(["--lang", "auto", "status"]), {
    args: ["status"],
    override: "auto",
  });
  for (const args of [
    ["--lang"],
    ["--lang", "fr"],
    ["--lang", "en", "--lang", "zh-CN"],
  ])
    assert.throws(
      () => parseLanguageArgs(args),
      (e: any) => e.code === "INVALID_PARAMS",
    );
});

test("偏好原子保存、损坏修复、无关字段及失败保护", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-i18n-preferences-"));
  try {
    assert.deepEqual(readLocalePreference(dir), {
      preference: "auto",
      source: "system",
      corrupt: false,
    });
    writeFileSync(
      join(dir, "preferences.json"),
      JSON.stringify({
        version: 1,
        localePreference: "en",
        future: { keep: true },
      }),
    );
    saveLocalePreference(dir, "zh-CN");
    assert.deepEqual(
      JSON.parse(readFileSync(join(dir, "preferences.json"), "utf8")),
      { version: 1, localePreference: "zh-CN", future: { keep: true } },
    );
    writeFileSync(join(dir, "preferences.json"), "broken");
    assert.equal(readLocalePreference(dir).corrupt, true);
    saveLocalePreference(dir, "auto");
    assert.equal(readLocalePreference(dir).corrupt, false);
    const bad = join(dir, "not-a-directory");
    writeFileSync(bad, "untouched");
    assert.throws(
      () => saveLocalePreference(bad, "en"),
      (e: any) => e.code === "PREFERENCE_WRITE_FAILED",
    );
    assert.equal(readFileSync(bad, "utf8"), "untouched");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI 真实进程语言查询、保存、覆盖、损坏警告与 JSON stdout", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-i18n-cli-"));
  const run = (args: string[]) =>
    spawnSync(
      process.execPath,
      ["--import", "tsx", "src/connector/main.ts", ...args],
      {
        encoding: "utf8",
        env: {
          ...process.env,
          BUGPAW_HOME: dir,
          BUGPAW_INSTALL_ROOT: dir,
          LC_ALL: "en_US.UTF-8",
          NODE_NO_WARNINGS: "1",
        },
      },
    );
  try {
    let result = run(["language"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Preference: auto/);
    assert.equal(existsSync(join(dir, "config.json")), false);
    assert.equal(existsSync(join(dir, "master.key")), false);
    result = run(["language", "zh-CN"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /已保存/);
    result = run(["--cli", "language"]);
    assert.match(result.stdout, /当前语言：zh-CN/);
    result = run(["--lang", "en", "language"]);
    assert.match(result.stdout, /command option/);
    assert.equal(readLocalePreference(dir).preference, "zh-CN");
    const old = readFileSync(join(dir, "preferences.json"), "utf8");
    for (const args of [
      ["language", "fr"],
      ["language", "en", "extra"],
      ["--lang", "bad", "start"],
    ])
      assert.equal(run(args).status, 1);
    assert.equal(readFileSync(join(dir, "preferences.json"), "utf8"), old);
    result = run(["status", "--lang", "en"]);
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).status, "stopped");
    result = run(["stop", "--lang", "en"]);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), { running: false });
    writeFileSync(join(dir, "preferences.json"), "broken");
    result = run(["status"]);
    assert.equal(result.status, 0);
    assert.match(result.stderr, /damaged/);
    assert.equal(JSON.parse(result.stdout).running, false);
    result = run(["language", "auto"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /saved/);
    result = run(["language", "en"]);
    assert.equal(result.status, 0);
    assert.equal(readLocalePreference(dir).preference, "en");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("错误结构支持切换语言并屏蔽未知异常与敏感参数", () => {
  const error = new AppError(
    "ROOT_ABSOLUTE",
    message("connector.roots.absoluteRequired"),
    400,
  );
  const zh = errorBody(error, "zh-CN"),
    en = errorBody(error, "en");
  assert.equal(zh.code, en.code);
  assert.notEqual(zh.message, en.message);
  assert.equal(localizeError("en", zh), en.message);
  assert.equal(localizeError("en", { code: "ROOT_ABSOLUTE" }), en.message);
  assert.equal(
    localizeError("en", { code: "BUSY" }),
    messages["common.failure"].en,
  );
  assert.equal(
    localizeError("en", { messageKey: "old.key" }),
    messages["common.failure"].en,
  );
  const unsafe = Object.assign(new AppError("EXAMPLE", "secret"), {
    messageKey: "connector.roots.absoluteRequired",
    messageParams: { apiKey: "secret" },
  });
  assert.doesNotMatch(JSON.stringify(errorBody(unsafe, "en")), /secret|apiKey/);
  assert.doesNotMatch(
    JSON.stringify(errorBody(new Error("secret"), "en")),
    /secret/,
  );
  const parsed = z
    .object({ password: z.string().min(12) })
    .safeParse({ password: "secret" });
  assert.equal(parsed.success, false);
  const body = errorBody(parsed.error, "zh-CN");
  assert.equal(body.code, "VALIDATION");
  assert.deepEqual(body.issues?.[0].path, ["password"]);
  assert.doesNotMatch(JSON.stringify(body), /secret|Too small/);
});

test("服务端语言偏好按实例持久化，匿名读取仅返回系统默认", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-instance-language-"));
  const options = { dataDir: dir, publicUrl: "http://localhost" };
  let instance = await createApp(options);
  const origin = options.publicUrl;
  const cookie = "relay_session=locale-fixture";
  const status = async (authenticated: boolean) =>
    (
      await instance.app.inject({
        url: "/api/auth/status",
        headers: authenticated ? { cookie } : {},
      })
    ).json().language;
  const save = (value: string, headers: Record<string, string>) =>
    instance.app.inject({
      method: "POST",
      url: "/api/settings/language",
      headers,
      payload: { preference: value },
    });
  try {
    instance.store.put("users", { username: "fixture" }, "owner");
    instance.store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest("locale-fixture"), "owner", Date.now() + 60000);
    const serverLocale = systemLocale();
    const initial = { preference: "auto", locale: serverLocale, serverLocale };
    const chosen = serverLocale === "en" ? "zh-CN" : "en";
    assert.deepEqual(await status(false), initial);
    assert.equal((await save(chosen, { origin })).statusCode, 401);
    assert.equal(
      (await save(chosen, { origin: "https://example.invalid", cookie }))
        .statusCode,
      403,
    );
    const saved = { preference: chosen, locale: chosen, serverLocale };
    assert.deepEqual((await save(chosen, { origin, cookie })).json(), saved);
    assert.equal((await save("fr", { origin, cookie })).statusCode, 400);
    await instance.app.close();
    instance = await createApp(options);
    assert.deepEqual(await status(true), saved);
    assert.deepEqual(await status(false), initial);
    assert.deepEqual((await save("auto", { origin, cookie })).json(), initial);
  } finally {
    await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("服务端中英文并发认证与字段错误不串语言", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-i18n-http-"));
  const { app, service } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost:3180",
  });
  try {
    const project = service.save("projects", {
      name: "用户项目",
      directories: [],
    });
    const done = randomUUID();
    const board = service.save("boards", {
      name: "用户名称",
      projectId: project.id,
      stages: [
        {
          fixedRole: "start",
          id: randomUUID(),
          name: "用户阶段",
          type: "human",
          targets: [done],
        },
        { id: done, name: "用户终点", type: "done", targets: [] },
      ],
    });
    const operationId = randomUUID();
    const copy = service.copyBoard(board.id, operationId, "zh-CN");
    assert.equal(copy.name, "用户名称 副本");
    assert.deepEqual(service.copyBoard(board.id, operationId, "en"), copy);
    assert.equal(
      service.copyBoard(board.id, undefined, "en").name,
      "用户名称 copy",
    );
    assert.equal(copy.stages[0].name, "用户阶段");
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        app.inject({
          url: "/api/state",
          headers: { "accept-language": i % 2 ? "en" : "zh-TW" },
        }),
      ),
    );
    for (const [i, response] of responses.entries()) {
      assert.equal(response.statusCode, 401);
      assert.equal(response.json().code, "UNAUTHENTICATED");
      assert.equal(
        response.headers["content-language"],
        i % 2 ? "en" : "zh-CN",
      );
      assert.match(String(response.headers.vary), /Accept-Language/);
      assert.equal(
        response.json().message,
        translate(i % 2 ? "en" : "zh-CN", response.json().messageKey),
      );
    }
    for (const locale of ["zh-CN", "en"] as const) {
      const response = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: { origin: "http://localhost:3180", "accept-language": locale },
        payload: {},
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().code, "VALIDATION");
      assert.ok(response.json().issues.length);
      assert.equal(
        response.json().message,
        messages["validation.invalid"][locale],
      );
    }
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("连接器本机真实 HTTP 保留认证边界并本地化错误", async (t) => {
  t.mock.method(console, "log", () => {});
  const dir = mkdtempSync(join(tmpdir(), "relay-i18n-local-"));
  const { app, url } = await startWeb(new ConnectorConfig(dir), false);
  const target = new URL(url),
    token = target.hash.slice(1);
  try {
    const results = await Promise.all(
      ["zh-CN", "en"].map(async (locale) => {
        const response = await fetch(target.origin + "/api/config", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Accept-Language": locale,
            Origin: target.origin,
            Authorization: `Bearer ${token}`,
          },
          body: "{}",
        });
        return { locale, response, body: (await response.json()) as any };
      }),
    );
    for (const { locale, response, body } of results) {
      assert.equal(response.status, 400);
      assert.equal(body.code, "VALIDATION");
      assert.equal(response.headers.get("content-language"), locale);
      assert.equal(
        body.message,
        translate(locale as "en" | "zh-CN", body.messageKey),
      );
    }
    const denied = await fetch(target.origin + "/api/config", {
      headers: { "Accept-Language": "en" },
    });
    assert.equal(((await denied.json()) as any).code, "AUTH_REQUIRED");
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("RPC 增量消息键可跨语言渲染且旧错误安全回退", async () => {
  let client: RpcPeer;
  const server = new RpcPeer(
    (raw) => void client.receive(raw),
    async () => {
      throw new AppError(
        "ROOT_ABSOLUTE",
        message("connector.roots.absoluteRequired"),
      );
    },
  );
  client = new RpcPeer(
    (raw) => void server.receive(raw),
    async () => null,
  );
  try {
    await assert.rejects(client.call("test"), (error: any) => {
      assert.equal(error.code, "ROOT_ABSOLUTE");
      assert.equal(error.messageKey, "connector.roots.absoluteRequired");
      assert.equal(
        errorBody(error, "en").message,
        messages["connector.roots.absoluteRequired"].en,
      );
      return true;
    });
  } finally {
    client.close();
    server.close();
  }
});

/** 只扫描业务错误调用参数；注释、运维日志、用户正文和前端待接续模板不在此门槛内。 */
test("后端业务错误不得新增硬编码中文消息", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory()
        ? walk(join(dir, entry.name))
        : entry.name.endsWith(".ts")
          ? [join(dir, entry.name)]
          : [],
    );
  for (const file of ["src/server", "src/connector", "src/shared"].flatMap(
    walk,
  )) {
    if (file.endsWith("console-ui.ts")) continue;
    const source = readFileSync(file, "utf8");
    for (const call of source.matchAll(/\b(ensure|new AppError)\s*\(/g)) {
      const start = call.index! + call[0].length;
      const tokens =
        /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/[^\n]*|\/\*[\s\S]*?\*\/|[()[\]{},]/g;
      tokens.lastIndex = start;
      let depth = 0,
        from = start;
      const args: string[] = [];
      for (;;) {
        const token = tokens.exec(source);
        if (!token) break;
        if (["(", "[", "{"].includes(token[0])) depth++;
        else if ([")", "]", "}"].includes(token[0])) {
          if (!depth) {
            args.push(source.slice(from, token.index));
            break;
          }
          depth--;
        } else if (token[0] === "," && !depth) {
          args.push(source.slice(from, token.index));
          from = tokens.lastIndex;
        }
      }
      const argument = args[call[1] === "ensure" ? 2 : 1]?.trim() || "";
      if (/^["'`]/.test(argument))
        assert.doesNotMatch(argument, /[\p{Script=Han}]/u, file);
    }
  }
});
