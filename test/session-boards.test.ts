import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/server/app.js";
import { ConnectorStore } from "../src/connector/store.js";
import { Engine } from "../src/connector/engine.js";
import { defaultBoardStages } from "../src/shared/board-stages.js";
import { stageSchema } from "../src/shared/contracts.js";
import { boardCapability } from "../src/shared/session-boards.js";

test("引用范围、目录匹配、写审批、真实附件交付及本地回执重放", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "session-boards-"));
  const { store, service, app, sessionBoards } = await createApp({
    dataDir: join(root, "server"),
    publicUrl: "https://app.example.test",
  });
  t.after(() => app.close());
  const local = new ConnectorStore(join(root, "environment.db"));
  const engine = new Engine(
    local,
    () => ({ roots: [{ id: "workspace", path: root }] }),
    () => {},
    async () => {
      throw Error("unexpected callback");
    },
  );
  t.after(() => {
    engine.close();
    local.close();
  });
  let loseReply = "";
  const peer: any = { call: async (method: string, args: unknown) => {
    const result = await engine.call(method, args);
    if (loseReply === method) {
      loseReply = "";
      throw Error("test: dropped reply");
    }
    return result;
  }, close() {} };
  const environment = store.put("environments", {
    approved: true,
    platform: process.platform + "/" + process.arch,
    name: "source",
    capabilities: [boardCapability, "board-attachments-v1"],
    roots: [{ id: "workspace", path: root }],
  });
  service.peers.set(environment.id, peer);
  const source = {
    environmentId: environment.id,
    rootId: "workspace",
    relativePath: "src",
  };
  const target = { ...source, relativePath: "dst" };
  await mkdir(join(root, "src"));
  await mkdir(join(root, "dst"));
  const body = "需求正文".repeat(70000);
  await writeFile(join(root, "src", "prd.md"), body);
  const project = service.save("projects", {
    name: "Example",
    directories: [source, target],
  });
  const agent = store.put("agents", {
    name: "agent",
    supportedRuntimes: ["codex"],
  });
  const [human, done] = defaultBoardStages(randomUUID(), randomUUID()).map(
    (stage, i) => ({ ...stage, shortId: i ? "S3" : "S1" }),
  );
  const stage = stageSchema.parse({
    id: randomUUID(),
    type: "agent",
    name: "Dev",
    shortId: "S2",
    agentId: agent.id,
    ...target,
    targets: [done.id],
  });
  const board = store.put("boards", {
    name: "Board",
    projectId: project.id,
    stages: [human, stage, done],
  });
  const executionId = randomUUID();
  const session = store.put("sessions", {
    ...source,
    projectId: project.id,
    executionId,
    permission: "ask",
  });
  local.put("localSessions", { cwd: join(root, "src") }, session.id);
  local.put(
    "localExecutions",
    { sessionId: session.id, status: "running" },
    executionId,
  );
  store.db
    .prepare("INSERT INTO executions VALUES(?,NULL,?,?,'running',?,?)")
    .run(
      executionId,
      session.id,
      environment.id,
      JSON.stringify({ boardIds: [board.id], permission: "ask" }),
      new Date().toISOString(),
    );
  const call = (
    method: string,
    args: unknown,
    callId: string = randomUUID(),
  ): Promise<any> =>
    sessionBoards.agent(method, environment.id, peer, {
      executionId,
      args,
      callId,
    });
  const args = { boardId: board.id };
  await assert.rejects(call("definition", args), { code: "BOARD_SCOPE" });
  await call("accept", {});
  assert.equal((await call("references", {})).boards[0].boardId, board.id);
  const definition = () => call("definition", args);
  assert.deepEqual(
    (await definition()).stages.map((s: any) => s.match),
    ["not_applicable", "different_directory", "not_applicable"],
  );
  const other = store.put(
    "environments",
    { ...environment, name: "other" },
    randomUUID(),
  );
  for (const [binding, expected] of [
    [source, "same_directory"],
    [{ ...target, rootId: "missing" }, "unknown"],
    [{ ...source, environmentId: other.id }, "different_environment"],
  ] as const) {
    store.put(
      "boards",
      { stages: [human, { ...stage, ...binding }, done] },
      board.id,
    );
    assert.equal((await definition()).stages[1].match, expected);
  }
  store.put("boards", { stages: [human, stage, done] }, board.id);
  const draft = {
    ...args,
    title: "需求",
    summary: "摘要",
    acceptance: "验收",
    files: ["prd.md"],
    startStageId: stage.id,
  };
  const decide = (id: string, approve: boolean): Promise<any> =>
    sessionBoards.decide(session.id, id, approve);
  const denied = await call("create", draft);
  await decide(denied.requestId, false);
  assert.equal((await decide(denied.requestId, true)).status, "denied");
  const stale = await call("create", draft);
  store.put("boards", { name: "Renamed" }, board.id);
  await assert.rejects(decide(stale.requestId, true), {
    code: "BOARD_VERSION_CONFLICT",
  });
  const changed = await call("create", draft);
  await writeFile(join(root, "src", "prd.md"), body + "1");
  await assert.rejects(decide(changed.requestId, true), {
    code: "FILE_CHANGED",
  });
  assert.equal(store.list("items").length, 0);
  const broken = await call("create", draft);
  loseReply = "files.push.write";
  await assert.rejects(decide(broken.requestId, true));
  assert.equal(store.list("items").length, 0);
  assert.equal(local.list("boardCards").length, 0);
  const request = await call("create", draft, "call1");
  assert.equal(request.status, "pending");
  assert.equal(
    sessionBoards.pending(session.id)[0].plan.destination.cwd,
    join(root, "dst"),
  );
  const [created, replay] = await Promise.all([
    decide(request.requestId, true),
    decide(request.requestId, true),
  ]);
  assert.deepEqual(created, replay);
  assert.equal(created.status, "queued");
  assert.equal(store.list("items").length, 1);
  const attachment = service.itemEditView(created.itemId).attachments[0];
  assert.equal(
    await readFile(join(root, "dst", attachment.path), "utf8"),
    body + "1",
  );
  assert.equal((await call("create", draft, "call1")).itemId, created.itemId);
  assert.equal((await service.sessionHistory(session.id)).boardCards.length, 1);
  const busy = await call("archive", { ...args, itemId: created.itemId });
  await assert.rejects(decide(busy.requestId, true), { code: "BUSY" });
  store.put("sessions", { permission: "full" }, session.id);
  store.db
    .prepare("UPDATE executions SET snapshot=? WHERE id=?")
    .run(JSON.stringify({ permission: "full" }), executionId);
  const manual = await call("create", {
    ...draft,
    startStageId: undefined,
    materialDirectory: source,
  });
  assert.equal(manual.status, "human");
  assert.match(
    store.get("items", manual.itemId).content,
    /\[prd.md\]\(prd.md\)/,
  );
  const selected = { ...args, itemId: manual.itemId };
  await call("archive", selected);
  assert.equal(
    (await call("list", { ...args, archived: true })).items[0].itemId,
    manual.itemId,
  );
  loseReply = "board.card.record";
  assert.equal((await call("share", selected)).outcome, "card_pending");
  await sessionBoards.recoverCards(session.id);
  assert.equal(local.list("boardCards").length, 3);
  assert.equal(
    (await service.sessionHistory(session.id)).boardCards.at(-1).archived,
    true,
  );
  // 两个连接器各自解析根目录并存储数据；内容必须通过附件链路到达目标环境。
  const remoteRoot = join(root, "remote");
  await mkdir(join(remoteRoot, "dst"), { recursive: true });
  const remoteStore = new ConnectorStore(join(remoteRoot, "environment.db"));
  const remoteEngine = new Engine(remoteStore, () => ({ roots: [{ id: "workspace", path: remoteRoot }] }),
    () => {}, async () => { throw Error("unexpected callback"); });
  t.after(() => { remoteEngine.close(); remoteStore.close(); });
  // 关闭数据库后释放临时目录，兼容 Windows 文件占用规则。
  t.after(() => rm(root, { recursive: true, force: true }));
  store.put("environments", {roots: [{ id: "workspace", path: remoteRoot }]}, other.id);
  service.peers.set(other.id, {call: remoteEngine.call.bind(remoteEngine), close() {}} as any);
  const remoteDir = {...target, environmentId: other.id};
  store.put("projects", {directories: [source, target, remoteDir]}, project.id);
  store.put("boards", {stages: [human, {...stage, ...remoteDir}, done]}, board.id);
  const remoteItem = await call("create", draft);
  assert.equal(remoteItem.status, "queued");
  const remoteFile = service.itemEditView(remoteItem.itemId).attachments[0];
  assert.equal(await readFile(join(remoteRoot, "dst", remoteFile.path), "utf8"), body + "1");
  assert.equal(remoteStore.list("boardCards").length, 0);
  assert.equal(local.list("boardCards").length, 4);
  const otherBoard = store.put("boards", { ...board }, randomUUID());
  await assert.rejects(
    call("detail", { boardId: otherBoard.id, itemId: manual.itemId }),
    { code: "BOARD_SCOPE" },
  );
  store.put("sessions", { boardIds: [otherBoard.id, board.id] }, session.id);
  await assert.rejects(
    call("detail", { boardId: otherBoard.id, itemId: manual.itemId }),
    { code: "BOARD_SCOPE" },
  );
});
