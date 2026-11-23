import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  SlashCatalog,
  claudeCatalog,
} from "../src/connector/slash-commands.js";
import { manualSend, manualSendSchema } from "../src/server/slash-commands.js";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import {
  commandCapability,
  slashInput,
  type CommandScope,
} from "../src/shared/slash-commands.js";

test("命令词仅匹配开头单段，参数保留内部空格", () => {
  for (const text of [
    "/tmp/app.log",
    "/tmp/a b",
    "text /name",
    "```\n/demo\n```",
  ])
    assert.equal(slashInput(text), null);
  assert.deepEqual(slashInput("/demo  one  two"), {
    name: "demo",
    args: "one  two",
  });
  assert.deepEqual(slashInput("/"), { name: "", args: "" });
});

test("重新发现时按项目实际解析授权，失效项目授权撤销，失败保留缓存", async () => {
  const store = new Store(":memory:");
  const builtin = {
    name: "rename",
    description: "rename",
    argumentHint: "title",
    aliases: ["name"],
    builtin: true,
  };
  const ext = { name: "name", description: "project", argumentHint: "" };
  const project = { name: "demo", description: "demo", argumentHint: "args" };
  let fail = false;
  let removed = false;
  const catalog = new SlashCatalog(store, async (_scope, cwd) => {
    if (fail) throw Error("DISCOVERY_FAILED");
    return claudeCatalog([
      builtin,
      ...(cwd === "A" ? [ext] : []),
      ...(removed ? [] : [project]),
    ]);
  });
  const scope: CommandScope = {
    runtime: "claude",
    projectId: randomUUID(),
    environmentId: randomUUID(),
    rootId: "r",
    relativePath: ".",
  };
  try {
    const b = await catalog.list(scope, "B", {});
    assert.ok(!b.some((r) => r.name === "rename"));
    const alias = b.find((r) => r.name === "name")!;
    await catalog.save(scope, "B", {}, { ...alias, enabled: true });
    assert.equal(
      (
        await catalog.resolve(
          { ...scope, projectId: randomUUID() },
          "C",
          {},
          "name",
        )
      ).execution,
      "rename",
    );
    await assert.rejects(catalog.resolve(scope, "A", {}, "name"), {
      code: "COMMAND_DISABLED",
    });
    await assert.rejects(
      catalog.save(scope, "A", {}, { ...alias, enabled: true }),
      { code: "COMMAND_STALE" },
    );
    await assert.rejects(
      catalog.resolve(
        { ...scope, environmentId: randomUUID() },
        "B",
        {},
        "name",
      ),
      { code: "COMMAND_DISABLED" },
    );
    const demo = b.find((r) => r.name === "demo")!;
    await catalog.save(scope, "B", {}, { ...demo, enabled: true });
    await assert.rejects(
      catalog.resolve({ ...scope, projectId: randomUUID() }, "B", {}, "demo"),
      { code: "COMMAND_DISABLED" },
    );
    fail = true;
    await assert.rejects(
      catalog.save(scope, "B", {}, { ...demo, enabled: false }),
      /DISCOVERY_FAILED/,
    );
    assert.ok(
      (await catalog.list(scope, "B", {}, true)).find((r) => r.name === "demo")!
        .enabled,
    );
    fail = false;
    removed = true;
    await assert.rejects(catalog.resolve(scope, "B", {}, "demo"), {
      code: "COMMAND_UNSUPPORTED",
    });
    removed = false;
    await assert.rejects(catalog.resolve(scope, "B", {}, "demo"), {
      code: "COMMAND_DISABLED",
    });
    await catalog.save(scope, "B", {}, { ...alias, enabled: false });
    await assert.rejects(catalog.resolve(scope, "B", {}, "name"), {
      code: "COMMAND_DISABLED",
    });
  } finally {
    store.close();
  }
});

test("历史会话选择按归属过滤，运行中可跳转，改名与字面分支错误不会创建执行", async () => {
  const dir = mkdtempSync(join(tmpdir(), "slash-"));
  const store = new Store(":memory:");
  const service = new Service(store, new Vault(dir));
  const env = store.put("environments", {
    approved: true,
    capabilities: [commandCapability],
  });
  const project = store.put("projects", {
    directories: [{ environmentId: env.id, rootId: "r", relativePath: "." }],
  });
  const base = {
    environmentId: env.id,
    projectId: project.id,
    runtime: "claude",
    rootId: "r",
    relativePath: ".",
    title: "two",
  };
  const s = store.put("sessions", { ...base, status: "running" });
  const target = store.put("sessions", base);
  store.put("sessions", { ...base, archived: true });
  store.put("sessions", { ...base, runtime: "codex" });
  store.put("sessions", { ...base, projectId: randomUUID() });
  service.peers.set(env.id, {
    call: async () => assert.fail("不应调用原生执行"),
  } as any);
  const send = (text: string, literal = false) =>
    manualSend(
      service,
      s.id,
      manualSendSchema.parse({
        message: text,
        operationId: randomUUID(),
        literal,
      }),
    );
  try {
    assert.equal((await send("/resume")).sessions.length, 2);
    assert.equal((await send("/resume two")).action, "chooseSession");
    assert.deepEqual((await send("/resume " + target.id)).sessions, [
      { id: target.id, title: "two" },
    ]);
    await assert.rejects(send("/resume missing"), {
      code: "COMMAND_NOT_FOUND",
    });
    await assert.rejects(send("/rename a"), { code: "BUSY" });
    await assert.rejects(send("/name", true), { code: "COMMAND_LITERAL" });
    assert.equal(store.get("sessions", s.id).status, "running");
    store.put("environments", { enabledRuntimes: [] }, env.id);
    await assert.rejects(send("/rename"), { code: "CLI_DISABLED" });
    store.put(
      "environments",
      { enabledRuntimes: ["claude"], capabilities: [] },
      env.id,
    );
    await assert.rejects(send("/rename"), { code: "CONNECTOR_UPGRADE" });
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
