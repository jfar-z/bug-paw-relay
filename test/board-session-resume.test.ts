import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/server/store.js";
import { ConnectorStore } from "../src/connector/store.js";
import { Engine } from "../src/connector/engine.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import { AppError } from "../src/shared/contracts.js";
import { boardSessionTitleCapability, handoffCapability } from "../src/shared/stage-handoff.js";

/** 真实双端 SQLite 和 Codex stdio 协议进程；只替换供应商，不替换账本、调度或 Engine。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-resume-"));
  const command = join(dir, "native-fixture.cjs");
  writeFileSync(
    command,
    `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const dir = __dirname;
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line', line => {
 const m = JSON.parse(line);
 if (m.id === undefined) return;
 const result = x => send({id:m.id,result:x});
 if (m.method === 'initialize') result({});
 if (m.method === 'thread/start' || m.method === 'thread/resume') {
   fs.appendFileSync(path.join(dir,'threads'), JSON.stringify({method:m.method, id:m.params.threadId})+'\\n');
   result({thread:{id:m.params.threadId || 'native-'+Math.random()}});
 }
 const titleFile = path.join(dir, 'title-'+m.params?.threadId);
 if (m.method === 'thread/name/set') {
   if (m.params.name === '拒绝改名') return send({id:m.id,error:{message:'injected rename failure'}});
   fs.writeFileSync(titleFile,m.params.name);
   result({});
 }
 if (m.method === 'thread/read') result({thread:{turns:[],name:fs.existsSync(titleFile)?fs.readFileSync(titleFile,'utf8'):null}});
 if (m.method === 'turn/start') {
   fs.appendFileSync(path.join(dir,'starts'), JSON.stringify(m.params.input[0].text)+'\\n');
   const mode = fs.readFileSync(path.join(dir,'mode'),'utf8');
   if (mode === 'fail') return send({id:m.id,error:{message:'injected native failure'}});
   setTimeout(() => result({turn:{id:'turn'}}), mode === 'delayed' ? 100 : 0);
   if (mode === 'complete') setTimeout(() => {
     send({method:'item/completed',params:{item:{type:'agentMessage',text:'reply'}}});
     send({method:'turn/completed',params:{turn:{id:'turn',status:'completed'}}});
   }, 30);
 }
 if (m.method === 'turn/interrupt') {
   result({});
   setTimeout(() => send({method:'turn/completed',params:{turn:{id:'turn',status:'interrupted'}}}),30);
 }
});
`,
    { mode: 0o700 },
  );
  writeFileSync(join(dir, "mode"), "complete");
  let local = new ConnectorStore(join(dir, "local.db"));
  let server = new Store(join(dir, "server.db"));
  let service = new Service(server, new Vault(dir));
  const env = server.put("environments", {
    approved: true,
    capabilities: [boardSessionTitleCapability, handoffCapability, "board-resume-v1"],
  });
  let forward = true;
  let invalidConfig = false;
  const config = () => ({
    roots: [{ id: "root", path: dir }],
    codex: {
      command,
      ...(invalidConfig ? { baseUrl: "https://invalid.example/v1" } : {}),
    },
  });
  const diagnostics: any[] = [];
  const createEngine = () =>
    new Engine(
      local,
      config,
      (_m, p) => {
        if (
          forward &&
          server.db
            .prepare("SELECT id FROM executions WHERE id=?")
            .get(p.executionId)
        )
          service.sessionEvent(env.id, p);
      },
      async () => ({}),
      (event, fields) => diagnostics.push({ event, ...fields }),
    );
  let engine = createEngine();
  let lose = "";
  const peer = {
    call: async (method: string, p: any) => {
      const result = await engine.call(method, p);
      if (method === lose) {
        lose = "";
        throw new AppError("STATUS_UNKNOWN", "injected lost response");
      }
      return result;
    },
  } as any;
  service.peers.set(env.id, peer);
  return {
    dir,
    diagnostics,
    env,
    peer,
    get local() {
      return local;
    },
    get server() {
      return server;
    },
    get engine() {
      return engine;
    },
    get service() {
      return service;
    },
    invalid(value: boolean) {
      invalidConfig = value;
    },
    mode(value: string) {
      writeFileSync(join(dir, "mode"), value);
    },
    lose(method: string) {
      lose = method;
    },
    forward(value: boolean) {
      forward = value;
    },
    starts() {
      try {
        return readFileSync(join(dir, "starts"), "utf8").trim().split("\n")
          .length;
      } catch {
        return 0;
      }
    },
    payload(sessionId = randomUUID()) {
      return {
        operationId: randomUUID(),
        executionId: randomUUID(),
        session: {
          id: sessionId,
          runtime: "codex",
          rootId: "root",
          relativePath: ".",
          permission: "ask",
        },
        message: "继续",
        workflow: {
          itemId: randomUUID(),
          handoffContractVersion: 2,
          currentStage: { shortId: "S1", name: "执行", type: "agent" },
          allowedTargets: [{ shortId: "S2", name: "完成", type: "done" }],
        },
      };
    },
    reopen() {
      engine.close();
      local.close();
      server.close();
      local = new ConnectorStore(join(dir, "local.db"));
      server = new Store(join(dir, "server.db"));
      service = new Service(server, new Vault(dir));
      engine = createEngine();
      service.peers.set(env.id, peer);
    },
    close() {
      engine.close();
      local.close();
      server.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 5000;
  while (!predicate()) {
    assert.ok(Date.now() < end, "等待账本状态超时");
    await new Promise((r) => setTimeout(r, 10));
  }
}
const code = (value: string) => (e: any) => e.code === value;

test("看板首轮及连续两轮续发：真实调度、响应丢失对账、双端重开与原生上下文", async () => {
  const f = fixture();
  try {
    const project = f.service.save("projects", {
      name: "项目",
      directories: [
        { environmentId: f.env.id, rootId: "root", relativePath: "." },
      ],
    });
    const stages = [randomUUID(), randomUUID()];
    const board = f.service.save("boards", {
      name: "看板",
      projectId: project.id,
      stages: [
        {
          id: randomUUID(),
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [],
        },
        {
          id: stages[0],
          type: "agent",
          agentId: f.service.save("agents", { name: "执行智能体" }).id,
          name: "开发",
          environmentId: f.env.id,
          rootId: "root",
          runtime: "codex",
          targets: [stages[1]],
          concurrency: 1,
        },
        { id: stages[1], type: "done", name: "完成", targets: [] },
      ],
    });
    const item = f.service.createItem({
      boardId: board.id,
      startStageId: board.stages[1].id,
      title: "甲".repeat(196) + "🐾乙",
      content: "第一轮",
    });
    const first = f.server.get("items", item.id).executionId;
    const sessionId = f.service.execution(first).session_id;
    f.server.put("items", { title: "排队后编辑" }, item.id);
    await f.service.tick();
    await until(() => f.service.execution(first).state === "completed");
    assert.equal(f.server.get("sessions", sessionId).title, "甲".repeat(196) + "-开发");
    const renamed = await f.engine.call("commands.rename", {
      environmentId: f.env.id, projectId: project.id, runtime: "codex", rootId: "root",
      relativePath: ".", name: "rename", sessionId, operationId: randomUUID(), title: "人工标题",
    });
    f.service.syncSessionTitle(sessionId, renamed.title);
    const ids = [first];
    const messages = ["续发", "## 进度\n\n- 请核对 **正文**"];
    for (let i = 0; i < messages.length; i++) {
      const op = randomUUID();
      const sent = await f.service.send(sessionId, op, messages[i]);
      assert.equal(sent.status, "queued");
      assert.equal(
        (await f.service.send(sessionId, op, messages[i])).executionId,
        sent.executionId,
      );
      await assert.rejects(
        f.service.send(sessionId, op, "冲突"),
        code("IDEMPOTENCY_CONFLICT"),
      );
      if (i === 1) {
        f.forward(false);
        f.lose("execution.startPrepared");
      }
      await Promise.all([f.service.tick(), f.service.tick()]);
      await until(
        () =>
          f.local.get("localExecutions", sent.executionId).status ===
          "completed",
      );
      if (i === 1) {
        assert.equal(f.service.execution(sent.executionId).state, "unknown");
        f.reopen();
        await f.service.reconcile(f.env.id, f.peer);
      }
      assert.equal(f.service.execution(sent.executionId).state, "completed");
      assert.equal(
        (
          await f.engine.call("execution.startPrepared", {
            executionId: sent.executionId,
          })
        ).status,
        "completed",
      );
      ids.push(sent.executionId);
    }
    const prompts = readFileSync(join(f.dir, "starts"), "utf8")
      .trimEnd()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.match(prompts[0], /第一轮/);
    assert.match(prompts[0], /## (当前阶段|Current stage)/);
    assert.deepEqual(prompts.slice(1), messages);
    assert.equal(f.local.list("preparedExecutions").length, 0);
    assert.equal(f.server.get("items", item.id).executionId, ids[2]);
    assert.equal(f.server.get("items", item.id).stageId, stages[0]);
    const snapshots = ids.map((id) =>
      JSON.parse(f.service.execution(id).snapshot),
    );
    assert.ok(
      snapshots.every(
        (s) => s.handoffContractVersion === 2 && s.stage.id === stages[0],
      ),
    );
    f.reopen();
    const history = await f.engine.call("session.history", { sessionId });
    assert.equal(history.title, "人工标题");
    await f.service.syncSessionTitles(f.env.id, f.peer);
    assert.equal(f.server.get("sessions", sessionId).title, "人工标题");
    assert.deepEqual(
      [...new Set(history.events.map((e: any) => e.executionId))],
      ids,
    );
    for (const executionId of ids)
      assert.equal(
        (await f.engine.call("execution.result", { executionId })).reply,
        "reply",
      );
    const threads = readFileSync(join(f.dir, "threads"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      threads.map((t) => t.method),
      ["thread/start", "thread/resume", "thread/resume"],
    );
    assert.equal(threads[1].id, threads[2].id);
  } finally {
    f.close();
  }
});

test("同操作并发与终态防重、同会话忙碌、不同会话隔离、取消和重启", async () => {
  const f = fixture();
  try {
    f.mode("delayed");
    const p = f.payload();
    const prepared = await Promise.all([
      f.engine.call("execution.prepare", p),
      f.engine.call("execution.prepare", p),
    ]);
    assert.ok(prepared.every((p) => p.status === "queued"));
    await assert.rejects(
      f.engine.call("execution.prepare", { ...p, message: "不同" }),
      code("IDEMPOTENCY_CONFLICT"),
    );
    await assert.rejects(
      f.engine.call("execution.prepare", {
        ...p,
        operationId: randomUUID(),
        session: { ...p.session, id: randomUUID() },
      }),
      code("IDEMPOTENCY_CONFLICT"),
    );
    await assert.rejects(
      f.engine.call("execution.start", f.payload(p.session.id)),
      code("BUSY"),
    );
    const started = f.engine.call("execution.startPrepared", {
      executionId: p.executionId,
    });
    const duplicate = f.engine.call("execution.start", p);
    await until(() => f.starts() === 1);
    assert.equal(
      (await f.engine.call("execution.prepare", p)).status,
      "dispatching",
    );
    const cancel = f.engine.call("execution.cancel", {
      executionId: p.executionId,
    });
    await Promise.all([started, duplicate]);
    assert.equal((await cancel).status, "stopping");
    await until(
      () =>
        f.local.get("localExecutions", p.executionId).status === "cancelled",
    );
    assert.equal(
      (await f.engine.call("execution.cancel", { executionId: p.executionId }))
        .status,
      "cancelled",
    );
    f.reopen();
    assert.equal(
      (await f.engine.call("execution.start", p)).status,
      "cancelled",
    );
    assert.equal(
      (
        await f.engine.call("execution.startPrepared", {
          executionId: p.executionId,
        })
      ).status,
      "cancelled",
    );
    const a = f.payload();
    const b = f.payload(a.session.id);
    const raced = await Promise.allSettled([
      f.engine.call("execution.prepare", a),
      f.engine.call("execution.prepare", b),
    ]);
    assert.equal(raced.filter((r) => r.status === "fulfilled").length, 1);
    const queued = f.local.list("preparedExecutions")[0];
    assert.equal(
      (await f.engine.call("execution.cancel", { executionId: queued.id }))
        .status,
      "cancelled",
    );
    assert.equal(
      (await f.engine.call("execution.cancel", { executionId: queued.id }))
        .status,
      "cancelled",
    );
    f.reopen();
    assert.equal(
      (
        await f.engine.call("execution.startPrepared", {
          executionId: queued.id,
        })
      ).status,
      "cancelled",
    );
    f.mode("complete");
    const c = f.payload();
    const d = f.payload();
    await Promise.all([
      f.engine.call("execution.start", c),
      f.engine.call("execution.start", d),
    ]);
    await until(() =>
      [c, d].every(
        (p) =>
          f.local.get("localExecutions", p.executionId).status === "completed",
      ),
    );
    assert.equal(f.starts(), 3);
    assert.equal(
      f.local.get("localExecutions", c.executionId).sessionId,
      c.session.id,
    );
    assert.equal(
      f.local.get("localExecutions", d.executionId).sessionId,
      d.session.id,
    );
  } finally {
    f.close();
  }
});

test("转换提交失败原子回滚，原生启动失败持久化且新尝试可以成功", async () => {
  const f = fixture();
  try {
    const p = f.payload();
    await f.engine.call("execution.prepare", p);
    f.local.db.exec(
      `CREATE TRIGGER fail_conversion BEFORE UPDATE ON entities WHEN NEW.kind='localExecutions' AND json_extract(NEW.body,'$.eventsExternal')=1 BEGIN SELECT RAISE(ABORT,'injected'); END`,
    );
    await assert.rejects(
      f.engine.call("execution.startPrepared", { executionId: p.executionId }),
      /injected/,
    );
    assert.equal(f.starts(), 0);
    assert.equal(
      f.local.get("preparedExecutions", p.executionId).status,
      "queued",
    );
    assert.equal(f.local.list("localSessions").length, 0);
    assert.equal(
      (
        f.local.db
          .prepare("SELECT count(*) AS n FROM local_events")
          .get() as any
      ).n,
      0,
    );
    f.local.db.exec("DROP TRIGGER fail_conversion");
    f.reopen();
    f.mode("fail");
    await assert.rejects(
      f.engine.call("execution.startPrepared", { executionId: p.executionId }),
      code("NATIVE_ERROR"),
    );
    assert.equal(
      (
        await f.engine.call("execution.startPrepared", {
          executionId: p.executionId,
        })
      ).status,
      "failed",
    );
    assert.equal(
      (await f.engine.call("execution.prepare", p)).status,
      "failed",
    );
    f.reopen();
    assert.equal((await f.engine.call("execution.start", p)).status, "failed");
    const invalid = f.payload(p.session.id);
    await f.engine.call("execution.prepare", invalid);
    f.invalid(true);
    await assert.rejects(
      f.engine.call("execution.startPrepared", {
        executionId: invalid.executionId,
      }),
      code("CONFIG_REQUIRED"),
    );
    assert.equal(
      f.local.get("localExecutions", invalid.executionId).status,
      "failed",
    );
    f.invalid(false);
    f.mode("complete");
    const next = f.payload(p.session.id);
    await f.engine.call("execution.prepare", next);
    await f.engine.call("execution.startPrepared", {
      executionId: next.executionId,
    });
    await until(
      () =>
        f.local.get("localExecutions", next.executionId).status === "completed",
    );
    assert.equal(f.starts(), 2);
    assert.equal(
      f.local.get("localExecutions", p.executionId).status,
      "failed",
    );
    assert.ok(
      (
        await f.engine.call("session.history", { sessionId: p.session.id })
      ).events.some((e: any) => e.executionId === p.executionId),
    );
  } finally {
    f.close();
  }
});

/** 崩溃留下 starting/waiting 时只对账失败，失效审批不得应用到新尝试。 */
test("转换后重启不重放，过期交互隔离，转换前取消与晚到写回不能复活", async () => {
  const f = fixture();
  try {
    const p = f.payload();
    await f.engine.call("execution.prepare", p);
    const start = f.engine.call("execution.startPrepared", {
      executionId: p.executionId,
    });
    const cancel = f.engine.call("execution.cancel", {
      executionId: p.executionId,
    });
    await start;
    await cancel;
    await until(
      () =>
        f.local.get("localExecutions", p.executionId).status === "cancelled" ||
        f.local.get("localExecutions", p.executionId).status === "completed",
    );
    // 构造进程消失但事务已提交的磁盘边界，后续仅走生产启动恢复路径。
    const crashed = f.payload();
    await f.engine.call("execution.prepare", crashed);
    f.local.transaction(() => {
      const queued = f.local.get("preparedExecutions", crashed.executionId);
      f.local.promoteExecution(
        crashed.executionId,
        queued.hash,
        crashed.session.id,
      );
      f.local.put("localSessions", crashed.session, crashed.session.id);
      f.local.put(
        "localExecutions",
        {
          status: "waiting",
          sequence: 1,
          events: [
            { sequence: 1, type: "user", data: { text: crashed.message } },
          ],
          interactions: [{ id: "expired" }],
        },
        crashed.executionId,
      );
    });
    assert.throws(
      () =>
        f.local.put(
          "preparedExecutions",
          { status: "queued" },
          crashed.executionId,
        ),
      code("CONFLICT"),
    );
    const count = f.starts();
    f.reopen();
    assert.equal(
      (
        await f.engine.call("execution.startPrepared", {
          executionId: crashed.executionId,
        })
      ).status,
      "failed",
    );
    assert.equal(
      (await f.engine.call("execution.start", crashed)).status,
      "failed",
    );
    await assert.rejects(
      f.engine.call("interaction.answer", {
        executionId: crashed.executionId,
        interactionId: "expired",
        answer: { decision: "accept" },
      }),
      code("STALE_INTERACTION"),
    );
    assert.equal(f.local.executionEvents(crashed.executionId).length, 1);
    assert.deepEqual(
      f.local.get("localExecutions", crashed.executionId).interactions,
      [],
    );
    assert.equal(f.starts(), count);
    const next = f.payload(crashed.session.id);
    f.mode("delayed");
    const pending = f.engine.call("execution.start", next);
    assert.equal(
      (await f.engine.call("execution.start", crashed)).status,
      "failed",
    );
    await pending;
  } finally {
    f.close();
  }
});

test("服务端失败后显式重试、阶段容量和旧失败状态不污染当前执行", async () => {
  const f = fixture();
  try {
    const project = f.service.save("projects", {
      name: "项目",
      directories: [
        { environmentId: f.env.id, rootId: "root", relativePath: "." },
      ],
    });
    const stages = [randomUUID(), randomUUID()];
    const board = f.service.save("boards", {
      name: "看板",
      projectId: project.id,
      stages: [
        {
          id: randomUUID(),
          fixedRole: "start",
          name: "起点",
          type: "human",
          targets: [],
        },
        {
          id: stages[0],
          type: "agent",
          agentId: f.service.save("agents", { name: "执行智能体" }).id,
          name: "开发",
          environmentId: f.env.id,
          rootId: "root",
          runtime: "codex",
          targets: [stages[1]],
          concurrency: 1,
        },
        { id: stages[1], type: "done", name: "完成", targets: [] },
      ],
    });
    const first = f.service.createItem({
      boardId: board.id,
      startStageId: board.stages[1].id,
      title: "任务一",
    });
    const oldId = f.server.get("items", first.id).executionId;
    f.mode("fail");
    await f.service.tick();
    assert.equal(f.service.execution(oldId).state, "failed");
    const retried = f.service.retry(first.id);
    assert.notEqual(retried.executionId, oldId);
    f.mode("hold");
    await f.service.tick();
    const current = f.service.execution(retried.executionId);
    assert.notEqual(current.session_id, f.service.execution(oldId).session_id);
    assert.equal(current.state, "running");
    const second = f.service.createItem({
      boardId: board.id,
      startStageId: board.stages[1].id,
      title: "任务二",
    });
    const secondId = f.server.get("items", second.id).executionId;
    await f.service.tick();
    assert.equal(f.service.execution(secondId).state, "queued");
    assert.equal(f.starts(), 2);
    f.service.setState(oldId, "failed");
    assert.equal(
      f.server.get("items", first.id).executionId,
      retried.executionId,
    );
    assert.equal(f.server.get("items", first.id).status, "running");
    await f.service.stop(retried.executionId);
    await until(
      () => f.service.execution(retried.executionId).state === "cancelled",
    );
    f.mode("complete");
    await f.service.tick();
    await until(() => f.service.execution(secondId).state === "completed");
    // 失败的续发留在原会话，下一次显式发送创建新尝试，旧操作重发仅查询失败。
    const sessionId = f.service.execution(secondId).session_id;
    const op = randomUUID();
    const failed = await f.service.send(sessionId, op, "失败续发");
    f.mode("fail");
    await f.service.tick();
    assert.equal(f.service.execution(failed.executionId).state, "failed");
    assert.equal(
      (await f.service.send(sessionId, op, "失败续发")).executionId,
      failed.executionId,
    );
    const next = await f.service.send(sessionId, randomUUID(), "再次续发");
    f.mode("complete");
    await f.service.tick();
    await until(
      () => f.service.execution(next.executionId).state === "completed",
    );
    f.reopen();
    assert.equal(f.service.execution(failed.executionId).state, "failed");
    assert.equal(
      f.server.get("items", second.id).executionId,
      next.executionId,
    );
    assert.equal(
      f.local.get("localExecutions", next.executionId).sessionId,
      sessionId,
    );
    assert.equal(f.starts(), 5);
  } finally {
    f.close();
  }
});


test("原生改名失败保留标题并继续执行，重投仅返回已完成状态", async () => {
  const f = fixture();
  try {
    const payload = { ...f.payload(), initialSessionTitle: "拒绝改名" };
    await f.engine.call("execution.start", payload);
    await until(() => f.local.get("localExecutions", payload.executionId).status === "completed");
    await f.engine.call("execution.start", payload);
    assert.equal(f.starts(), 1);
    assert.deepEqual(f.diagnostics.filter(row => row.event === "board.sessionTitle.failed"), [
      { event: "board.sessionTitle.failed", sessionId: payload.session.id, executionId: payload.executionId },
    ]);
    assert.equal(f.local.get("localSessions", payload.session.id).title, payload.message);
  } finally {
    f.close();
  }
});
