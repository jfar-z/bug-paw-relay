import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  utimes,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createApp } from "../src/server/app.js";
import { EnvironmentFiles } from "../src/connector/files.js";
import { digest } from "../src/server/security.js";
import { stageSchema } from "../src/shared/contracts.js";

/** 临时真实文件与数据库覆盖上传事务、权限和离线读取，不调用模型。 */
async function fixture(allowArtifacts = true) {
  const dir = await mkdtemp(join(tmpdir(), "relay-artifacts-"));
  const root = join(dir, "root");
  await mkdir(root);
  await writeFile(join(root, "报告.md"), "# 交接产物\n".repeat(40000));
  const f = await createApp({
    dataDir: join(dir, "data"),
    publicUrl: "http://localhost:3180",
    secureCookie: false,
  });
  const env = f.store.put("environments", {
    name: "环境",
    approved: true,
    capabilities: ["files-v1"],
  });
  const reader = new EnvironmentFiles(() => [{ id: "root", path: root }]);
  let reads = 0;
  let afterRead = () => {};
  const peer: any = {
    call: async (m: string, p: any) => {
      const result = await reader.call(m, p);
      if (m === "files.read") {
        reads++;
        afterRead();
      }
      return result;
    },
    close: () => {},
  };
  f.service.peers.set(env.id, peer);
  const project = f.service.save("projects", {
    name: "产物项目",
    directories: [{ environmentId: env.id, rootId: "root", relativePath: "." }],
  });
  const stageId = randomUUID(),
    doneId = randomUUID();
  const board = f.service.save("boards", {
    name: "产物看板",
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
        id: stageId,
        name: "执行",
        type: "agent",
        agentId: f.service.save("agents", { name: "执行智能体" }).id,
        targets: [doneId],
        environmentId: env.id,
        rootId: "root",
        allowArtifacts,
      },
      { id: doneId, name: "已完成", type: "done", targets: [] },
    ],
  });
  const item = f.service.createItem({
    boardId: board.id,
    startStageId: board.stages[1].id,
    title: "交付报告",
  });
  const executionId = f.store.get("items", item.id).executionId;
  f.service.setState(executionId, "running");
  const p = {
    itemId: item.id,
    executionId,
    operationId: randomUUID() as string,
    targetId: "S3",
    record: "实现完成",
    artifacts: [{ path: "报告.md", name: "中文报告.md" }],
  };
  const cookie = randomUUID();
  f.store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 600000);
  const request = (url: string, payload: any = {}) =>
    f.app.inject({
      method: "POST",
      url,
      payload,
      headers: {
        origin: "http://localhost:3180",
        cookie: `relay_session=${cookie}`,
      },
    });
  const settle = async () => {
    for (let i = 0; i < 500; i++) {
      const result = f.artifacts.status(p.operationId, executionId, item.id);
      if (result.status !== "uploading") return result;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error("上传未结束");
  };
  return {
    ...f,
    dir,
    root,
    peer,
    env,
    board,
    item,
    stageId,
    doneId,
    p,
    request,
    settle,
    reads: () => reads,
    afterRead: (fn: () => void) => {
      afterRead = fn;
    },
    close: async () => {
      await f.app.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("阶段默认关闭；旧执行不能被后来开启的配置追授产物权限", async () => {
  const f = await fixture(false);
  try {
    assert.equal(
      stageSchema.parse({
        id: randomUUID(),
        name: "旧阶段",
        type: "human",
        targets: [],
      }).allowArtifacts,
      false,
    );
    assert.throws(() => f.artifacts.submit(f.p, f.peer), /未开启/);
    f.store.put(
      "boards",
      {
        stages: f.board.stages.map((s: any) => ({
          ...s,
          allowArtifacts: true,
        })),
      },
      f.board.id,
    );
    assert.throws(() => f.artifacts.submit(f.p, f.peer), /未开启/);
    assert.equal(f.reads(), 0);
    assert.equal(f.store.list("handoffs").length, 0);
  } finally {
    await f.close();
  }
});
test("分块上传后原子交接，重复提交去重，环境离线和会话删除后仍可下载", async () => {
  const f = await fixture();
  try {
    const legacy = { ...f.p, method: "workflow.handoff" };
    assert.equal(f.artifacts.submit(legacy, f.peer).status, "uploading");
    assert.equal(f.artifacts.submit(f.p, f.peer).status, "uploading");
    await f.settle();
    const handoff = f.store.list("handoffs")[0];
    assert.equal(handoff.artifacts.length, 1);
    const a = handoff.artifacts[0];
    const content = await readFile(join(f.root, "报告.md"));
    assert.equal(a.sha256, createHash("sha256").update(content).digest("hex"));
    const reads = f.reads();
    assert.equal(f.artifacts.submit(f.p, f.peer).stageId, f.doneId);
    assert.equal(f.reads(), reads);
    assert.equal(f.store.list("handoffs").length, 1);
    assert.throws(
      () => f.artifacts.submit({ ...f.p, record: "不同记录" }, f.peer),
      /参数不一致/,
    );
    f.service.peers.clear();
    for (const s of f.store.list("sessions")) f.store.remove("sessions", s.id);
    await rm(join(f.root, "报告.md"));
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/artifacts/${a.id}/files`,
          payload: {},
          headers: { origin: "http://localhost:3180" },
        })
      ).statusCode,
      401,
    );
    const response = await f.request(`/api/artifacts/${a.id}/files`);
    assert.equal(response.statusCode, 200, response.body);
    const ticket = response.json();
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < ticket.size;) {
      const r = await f.request(`/api/file-transfers/${ticket.id}/read`, {
        offset,
      });
      assert.equal(r.statusCode, 200);
      chunks.push(r.rawPayload);
      offset += r.rawPayload.length;
    }
    assert.deepEqual(Buffer.concat(chunks), content);
    f.service.remove("boards", f.board.id);
    assert.equal(
      (await f.request(`/api/artifacts/${a.id}/files`)).statusCode,
      404,
    );
    assert.equal(
      (await f.request(`/api/file-transfers/${ticket.id}/read`, { offset: 0 }))
        .statusCode,
      404,
    );
    const path = join(f.dir, "data/artifacts", a.id);
    await utimes(path, new Date(0), new Date(0));
    await f.artifacts.prune();
    await assert.rejects(readFile(path));
  } finally {
    await f.close();
  }
});
test("部分上传失败不推进，重试复用成功文件；重启后的暂存可继续交接", async () => {
  const f = await fixture();
  try {
    f.p.artifacts.push({ path: "later.txt", name: "稍后文件.txt" });
    f.artifacts.submit(f.p, f.peer);
    await assert.rejects(f.settle(), /不存在/);
    assert.equal(f.store.get("items", f.item.id).stageId, f.stageId);
    assert.equal(f.store.list("handoffs").length, 0);
    const first = f.store.list("artifacts")[0];
    assert.equal(
      (await f.request(`/api/artifacts/${first.id}/files`)).statusCode,
      404,
    );
    const reads = f.reads();
    await writeFile(join(f.root, "later.txt"), "后来上传");
    // 新建服务对象模拟丢失进程内上传状态，复用同一持久化数据库与文件。
    const { Artifacts } = await import("../src/server/artifacts.js");
    const { FileTransfers } = await import("../src/server/file-transfers.js");
    const resumed = new Artifacts(
      f.service,
      new FileTransfers(),
      join(f.dir, "data"),
    );
    resumed.submit(f.p, f.peer);
    await resumed.close();
    assert.equal(
      resumed.status(f.p.operationId, f.p.executionId, f.item.id).stageId,
      f.doneId,
    );
    assert.equal(f.reads() - reads, 1);
    assert.equal(f.store.list("handoffs")[0].artifacts[0].id, first.id);
  } finally {
    await f.close();
  }
});
test("上传中关闭开关、停止执行或撤销环境，不能落交接或推进", async () => {
  for (const change of ["disable", "stop", "revoke"]) {
    const f = await fixture();
    try {
      f.afterRead(() => {
        if (change === "disable")
          f.service.save(
            "boards",
            {
              ...f.board,
              stages: f.board.stages.map((s: any) => ({
                ...s,
                allowArtifacts: false,
              })),
            },
            f.board.id,
            f.board.version,
          );
        if (change === "stop") f.service.setState(f.p.executionId, "stopping");
        if (change === "revoke")
          f.store.put("environments", { revoked: true }, f.env.id);
      });
      f.artifacts.submit(f.p, f.peer);
      await assert.rejects(f.settle(), /未开启|过期|撤销/);
      assert.equal(f.store.list("handoffs").length, 0);
      assert.equal(f.store.get("items", f.item.id).stageId, f.stageId);
    } finally {
      await f.close();
    }
  }
});
test("产物拒绝越界、非法名称、超限文件和跨执行状态查询", async () => {
  const f = await fixture();
  try {
    assert.throws(() =>
      f.artifacts.submit(
        { ...f.p, artifacts: [{ path: "报告.md", name: "../x" }] },
        f.peer,
      ),
    );
    f.p.artifacts = [{ path: "../outside.txt", name: "outside.txt" }];
    await writeFile(join(f.dir, "outside.txt"), "禁止读取");
    f.artifacts.submit(f.p, f.peer);
    await assert.rejects(f.settle(), /超出/);
    assert.throws(
      () => f.artifacts.status(f.p.operationId, randomUUID(), f.item.id),
      /归属/,
    );
    assert.equal(f.store.list("handoffs").length, 0);
  } finally {
    await f.close();
  }
});

test("在途开启产物权限不会追授给已入队执行", async () => {
  const f = await fixture(false);
  try {
    const board = f.service.save("boards", {
      ...f.board,
      stages: f.board.stages.map((s: any) => ({ ...s, allowArtifacts: s.type === "agent" })),
    }, f.board.id, f.board.version);
    assert.equal(board.stages[1].allowArtifacts, true);
    assert.throws(() => f.artifacts.submit(f.p, f.peer), /未开启/);
  } finally {
    await f.close();
  }
});

test("超限产物不读取正文且不推进，操作 ID 不覆盖业务实体", async () => {
  const f = await fixture();
  try {
    const handle = await open(join(f.root, "large.bin"), "w");
    await handle.truncate(128 * 1024 ** 2 + 1);
    await handle.close();
    f.p.operationId = f.item.id;
    f.p.artifacts = [{ path: "large.bin", name: "大文件" }];
    f.artifacts.submit(f.p, f.peer);
    await assert.rejects(f.settle(), /最多/);
    assert.equal(f.reads(), 0);
    assert.equal(f.store.get("items", f.item.id).title, "交付报告");
    assert.equal(f.store.list("handoffs").length, 0);
  } finally {
    await f.close();
  }
});

test("SEC-16 产物同大小替换、截断、追加及签发后替换均拒绝", async () => {
  const f = await fixture();
  try {
    f.artifacts.submit(f.p, f.peer);
    await f.settle();
    const a = f.store.list("handoffs")[0].artifacts[0];
    const path = join(f.dir, "data/artifacts", a.id);
    const original = await readFile(path);
    const ticket = (await f.request(`/api/artifacts/${a.id}/files`)).json();
    for (const bytes of [
      Buffer.alloc(original.length, 65),
      original.subarray(1),
      Buffer.concat([original, Buffer.from("x")]),
    ]) {
      await writeFile(path, bytes);
      assert.notEqual(
        (await f.request(`/api/artifacts/${a.id}/files`)).statusCode,
        200,
      );
      assert.notEqual(
        (
          await f.request(`/api/file-transfers/${ticket.id}/read`, {
            offset: 0,
          })
        ).statusCode,
        200,
      );
    }
    await writeFile(path, original);
    assert.equal(
      (await f.request(`/api/artifacts/${a.id}/files`)).statusCode,
      200,
    );
  } finally {
    await f.close();
  }
});

test("短编号非法目标在任何产物传输前拒绝且不建立上传任务", async () => {
  const f = await fixture();
  try {
    for (const targetId of [f.doneId, "S2", "s2", "S10", "已完成"]) {
      assert.throws(
        () => f.artifacts.submit({ ...f.p, targetId }, f.peer),
        (e: any) => e.code === "INVALID_HANDOFF_TARGET",
      );
    }
    assert.equal(f.reads(), 0);
    assert.equal(f.store.list("artifactJobs").length, 0);
    assert.equal(f.store.list("handoffs").length, 0);
  } finally {
    await f.close();
  }
});
