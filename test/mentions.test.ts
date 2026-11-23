import { useInstalledClaudeSdk } from "./claude-sdk-fixture.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  mentionQuery,
  editMentions,
  validMentions,
  nativeMentionText,
  type Mention,
} from "../src/shared/mentions.js";
import { displayBoardHistory, historyEvents } from "../src/shared/session-events.js";
import { AppError } from "../src/shared/contracts.js";
import { EnvironmentMentions } from "../src/connector/mentions.js";
import { discoverSkills } from "../src/connector/runtime.js";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";

/** 引用边界必须与用户要求一致，选中引用编辑后不再隐式调用 Skill。 */
test("@ 触发边界、引用位置移动与原生文本转换", () => {
  for (const text of ["@", "请看 @foo", " @中文 空格"])
    assert.ok(mentionQuery(text, text.length, []));
  for (const text of ["a@b", "邮件 x@y.com", "\n@file", "\t@file"])
    assert.equal(mentionQuery(text, text.length, []), null);
  const refs: Mention[] = [
    {
      kind: "skill",
      name: "review",
      path: "/skills/review/SKILL.md",
      start: 0,
      end: 7,
    },
  ];
  assert.equal(mentionQuery("@review rest", 5, refs), null);
  assert.equal(mentionQuery("@review rest", 12, refs), null);
  assert.equal(mentionQuery("@review @file", 13, refs)?.query, "file");
  assert.equal(validMentions("@review rest", refs), true);
  assert.equal(validMentions("@revieX rest", refs), false);
  assert.deepEqual(editMentions("@review rest", "@revie rest", refs), []);
  assert.deepEqual(
    editMentions("@review rest", "text @review rest", refs).map((m) => [
      m.start,
      m.end,
    ]),
    [[5, 12]],
  );
  assert.deepEqual(editMentions("@review rest", "x@review rest", refs), []);
  assert.equal(
    nativeMentionText("@review rest", refs, "codex"),
    "$review rest",
  );
  assert.equal(
    nativeMentionText("@review rest", refs, "claude"),
    "/review rest",
  );
});

test("环境搜索限制十项，支持中文空格与其他根，拒绝越界和伪造 Skill", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-mentions-"));
  const root = join(dir, "root"),
    other = join(dir, "other");
  await mkdir(join(root, "project"), { recursive: true });
  await mkdir(other);
  await writeFile(join(other, "中文 空格.txt"), "fixture");
  await writeFile(join(dir, "private.txt"), "fixture");
  await symlink(join(dir, "private.txt"), join(root, "escape.txt"));
  for (let i = 0; i < 20; i++)
    await writeFile(join(root, `file-${i}.txt`), "fixture");
  const catalog = new EnvironmentMentions(
    () => ({ roots: [{ path: root }, { path: other }] }),
    async () => [
      { kind: "skill", name: "review", path: "/skills/review/SKILL.md" },
    ],
  );
  const cwd = join(root, "project");
  try {
    const first = await catalog.search(cwd, "codex", "");
    assert.equal(first.items.length, 10);
    assert.equal(first.items[0].kind, "skill");
    const search = await catalog.search(cwd, "codex", "中文 空格");
    assert.equal(search.items.length, 1);
    assert.equal(search.items[0].path, join(other, "中文 空格.txt"));
    const ref = { ...search.items[0], start: 0, end: 10 };
    await catalog.validate(cwd, "codex", [ref]);
    await assert.rejects(
      catalog.validate(cwd, "codex", [
        { ...ref, path: join(root, "escape.txt") },
      ]),
      /超出/,
    );
    await assert.rejects(
      catalog.validate(cwd, "codex", [
        { ...ref, kind: "skill", name: "review", path: "/forged/SKILL.md" },
      ]),
      /不可用/,
    );
    assert.equal(
      (await catalog.search(cwd, "codex", "escape")).items.length,
      0,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("超过两万项仍能按普通名称找到后代，前缀只遍历指定子树", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "relay-wide-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = join(root, "docs", "unique-folder");
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, "unique-report"), "");
  await writeFile(join(root, "outside-report"), "");
  await mkdir(join(root, ".git"));
  await writeFile(join(root, ".git", "secret"), "");
  for (let i = 0; i < 20100; i += 100)
    await Promise.all(Array.from({ length: 100 }, (_, j) => writeFile(join(root, String(i + j)), "")));
  const catalog = new EnvironmentMentions(() => ({ roots: [{ path: root }] }), async () =>
    Array.from({ length: 10 }, (_, index) => ({
      kind: "skill", name: "report-" + index, path: "/skills/" + index, description: "docs/unique-folder/unique-report",
    })));
  const exact = await catalog.search(root, "codex", "docs/unique-folder/unique-report");
  assert.equal(exact.items[0].path, join(folder, "unique-report"));
  for (const query of ["unique-folder", "unique-report"])
    assert.ok((await catalog.search(root, "codex", query)).items.some(item => item.name.endsWith(query)));
  const scoped = await catalog.search(root, "codex", "docs/report");
  assert.deepEqual(scoped.items.map(item => item.path), [join(folder, "unique-report")]);
  assert.deepEqual(scoped.warningMessages, []);
  assert.deepEqual((await catalog.search(root, "codex", ".git/sec")).items, []);
  // 模拟时间预算用尽，区分未完成与正常的空搜索。
  let time = 0;
  t.mock.method(Date, "now", () => time += 3000);
  const partial = await catalog.search(root, "codex", "missing");
  assert.equal(partial.warningMessages[0]?.messageKey, "connector.mentions.scanIncomplete");
  const withSkills = await catalog.search(root, "codex", "report");
  assert.equal(withSkills.items.length, 10);
  assert.equal(withSkills.warningMessages[0]?.messageKey, "connector.mentions.scanIncomplete");
});

test("看板发送按原生轮次回读，保留多个引用、手写 ID、重复发送及未知来源", () => {
  const text = "@A @B (boardId=literal)";
  const nativeText = "@A (boardId=a) @B (boardId=b) (boardId=literal)";
  for (const runtime of ["codex", "claude"]) {
    const events = ["1", "2"].flatMap(id => [
      { executionId: id, sequence: 1, type: "user", data: { text, ...(id === "2" ? { nativeText } : {}) } },
      { executionId: id, sequence: 2, type: runtime === "codex" ? "turn/started" : "assistant",
        data: runtime === "codex" ? { turn: { id } } : { uuid: "a" + id, message: { content: [] } } },
    ]);
    const ids = ["1", "2", "foreign"];
    const nativeHistory = runtime === "codex" ? { thread: { turns: ids.map(id => ({
      id, items: [{ id: "u" + id, type: "userMessage", content: [{ type: "text", text: nativeText }] },
        { id: "a" + id, type: "agentMessage", text: "ok" }],
    })) } } : ids.flatMap(id => [
      { uuid: "u" + id, type: "user", message: { content: nativeText } },
      { uuid: "a" + id, type: "assistant", message: { id: "a" + id, content: [{ type: "text", text: "ok" }] } },
    ]);
    const result = historyEvents({ nativeHistory, events, executionStarts: [{ id: "1", boardIds: ["a", "b"] }] });
    assert.deepEqual(result.filter(e => e.type === "user").map(e => e.data.text), [text, text, nativeText]);
    const earlier = displayBoardHistory(nativeHistory, new Map(ids.map(id =>
      [(runtime === "codex" ? "turn:" : "claude:a") + id, { executionId: id, text, nativeText }])));
    const pending = historyEvents({ nativeHistory: earlier,
      events: [{ executionId: "new", sequence: 1, type: "user", data: { text, nativeText } }] });
    assert.equal(pending.filter(row => row.type === "user").length, 4);
    assert.equal(pending.at(-1)?.executionId, "new");
    assert.equal(result[1].type, runtime === "codex" ? "item/completed" : "assistant");
    assert.equal(historyEvents({ events: [events[2], { executionId: "2", type: "user",
      data: { type: "user", uuid: "u2", message: { content: nativeText } } }] }).length, 1);
  }
});

for (const runtime of ["codex", "claude"] as const) {
  test(
    `${runtime} 原生发现项目 Skill，不创建模型回合`,
    { timeout: 30000 },
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "relay-skill-discovery-"));
      const home = join(dir, "home");
      const folder = join(
        dir,
        runtime === "codex" ? ".agents" : ".claude",
        "skills",
        "relay-fixture",
      );
      await mkdir(home);
      await mkdir(folder, { recursive: true });
      await writeFile(
        join(folder, "SKILL.md"),
        "---\nname: relay-fixture\ndescription: fixture discovery only\n---\nReturn the fixture token.\n",
      );
      try {
        const items = await discoverSkills(runtime, dir, {
          home,
          baseUrl: "http://127.0.0.1:1",
          apiKey: "fixture-not-real",
          model: "fixture",
        });
        assert.ok(
          items.some((s) => s.name === "relay-fixture"),
          JSON.stringify(items),
        );
        assert.ok(items.every((s) => s.kind === "skill"));
      } finally {
        // 原生 CLI 退出时仍可能写入诊断文件，允许文件系统清理短暂重试。
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 200,
        });
      }
    },
  );
}

test("引用 HTTP 鉴权、旧连接器提示、发送转发及幂等包含引用", async () => {
  const dir = await mkdtemp(join(tmpdir(), "relay-mention-api-"));
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
    secureCookie: false,
  });
  const cookie = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 60000);
  const headers = {
    cookie: "relay_session=" + cookie,
    origin: "http://localhost",
  };
  const env = store.put("environments", {
    name: "fixture",
    approved: true,
    capabilities: [],
  });
  const project = service.save("projects", {
    name: "fixture",
    directories: [{ environmentId: env.id, rootId: "root" }],
  });
  const calls: any[] = [];
  let environmentResult: any = { items: [] };
  let failSearch = false;
  service.peers.set(env.id, {
    call: async (method: string, p: any) => {
      calls.push({ method, p });
      if (method === "mentions.search" && failSearch) throw new AppError("INTERNAL", "fixture");
      return method === "mentions.search"
        ? environmentResult
        : { status: "completed" };
    },
    close() {},
  } as any);
  const session = service.createSession({
    agentId: service.save("agents", { name: "会话智能体" }).id,
    title: "fixture",
    projectId: project.id,
    environmentId: env.id,
    rootId: "root",
    runtime: "codex",
  });
  const url = `/api/sessions/${session.id}/mentions`;
  try {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers: { origin: "http://localhost" },
          payload: { query: "" },
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url,
          headers,
          payload: { query: "" },
        })
      ).json().code,
      "CONNECTOR_UPGRADE",
    );
    store.put("environments", { capabilities: ["mentions-v1"] }, env.id);
    const response = await app.inject({
      method: "POST",
      url,
      headers,
      payload: { query: "foo" },
    });
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.headers["cache-control"], "no-store");
    assert.equal(calls[0].p.rootId, "root");
    assert.equal(calls[0].p.runtime, "codex");
    const refs: Mention[] = [
      { kind: "file", name: "foo", path: "/work/foo", start: 0, end: 4 },
    ];
    const op = randomUUID();
    await service.send(session.id, op, "@foo", refs);
    assert.deepEqual(calls.at(-1).p.mentions, refs);
    await assert.rejects(
      service.send(session.id, op, "@foo", [
        { ...refs[0], path: "/work/other" },
      ]),
      /不同请求/,
    );
    await assert.rejects(
      service.send(session.id, randomUUID(), "wrong", refs),
      /不一致/,
    );
    const board = store.put("boards", { name: "foo", projectId: project.id, stages: [] });
    const ref = { kind: "board" as const, name: board.name, path: board.id, start: 0, end: 4 };
    await assert.rejects(service.send(session.id, randomUUID(), "@foo", [ref]), { code: "CONNECTOR_UPGRADE" });
    store.put("environments", { capabilities: ["mentions-v1", "session-board-v1"] }, env.id);
    const found = await app.inject({ method: "POST", url, headers, payload: { query: "foo" } });
    assert.equal(found.json().items[0].path, board.id);
    assert.match(found.json().items[0].description, /fixture/);
    environmentResult = { items: Array.from({ length: 10 }, (_, i) => ({
      kind: "skill", path: "/skills/" + i, name: "lookup-" + i, description: "oo",
    })) };
    const search = async (query: string) => (await app.inject({ method: "POST", url, headers, payload: { query } })).json();
    assert.equal((await search("OO")).items[0].path, board.id);
    environmentResult.items[9].name = "oo";
    assert.equal((await search("oo")).items[0].kind, "skill");
    failSearch = true;
    const degraded = await search("oo");
    assert.equal(degraded.items[0].path, board.id);
    assert.equal(degraded.warningMessages[0].messageKey, "connector.mentions.environmentUnavailable");
    failSearch = false;
    const plain = await service.send(session.id, randomUUID(), "@foo");
    assert.equal(JSON.parse(service.execution(plain.executionId).snapshot).boardIds, undefined);
    await assert.rejects(service.send(session.id, randomUUID(), "@bar", [{ ...ref, name: "bar" }]), {code: "MENTION_STALE"});
    const sent = await service.send(session.id, randomUUID(), "@foo", [ref]);
    assert.deepEqual(JSON.parse(service.execution(sent.executionId).snapshot).boardIds, [board.id]);
    assert.equal(calls.at(-1).p.session.boardTools, true);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

useInstalledClaudeSdk();
