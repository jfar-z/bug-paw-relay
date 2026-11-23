import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";
import { FilePushReceiver } from "../src/connector/file-push.js";
import { FilePushTransfers } from "../src/server/file-push.js";
import {
  attachmentSink,
  validateAttachments,
} from "../src/connector/attachments.js";
import { EnvironmentFiles } from "../src/connector/files.js";
import { EnvironmentMentions } from "../src/connector/mentions.js";
import {
  attachmentsSchema,
  attachmentMessage,
  uploadEntriesSchema,
  UPLOAD_FILE_LIMIT,
  type Attachment,
} from "../src/shared/uploads.js";
import { FILE_CHUNK_SIZE, classifyFileLink } from "../src/shared/files.js";
import { nativeMentionText } from "../src/shared/mentions.js";
import { createApp } from "../src/server/app.js";
import { Engine } from "../src/connector/engine.js";
import { Store } from "../src/server/store.js";
import { digest } from "../src/server/security.js";
import { RpcPeer } from "../src/shared/rpc.js";
import { workflowPrompt } from "../src/shared/stage-handoff.js";
import { nodeAuthVersion, nodeProofText } from "../src/shared/node-identity.js";

const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const chunk = (bytes: Buffer, offset = 0, index = 0) => ({
  index,
  offset,
  data: bytes.toString("base64"),
  sha256: sha(bytes),
});
/** 全部文件和数据库均在隔离临时目录，测试不访问真实环境数据。 */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "relay-uploads-"));
  const cwd = join(dir, "project");
  await mkdir(cwd);
  let roots = [{ id: "root", path: dir }];
  const files = new EnvironmentFiles(() => roots);
  const receiver = new FilePushReceiver();
  const source = { rootId: "root", relativePath: "project" };
  const begin = (entries: { name: string; size: number }[]) =>
    receiver.begin(
      entries,
      async () => {
        assert(roots.length, "roots revoked");
      },
      (entry) =>
        attachmentSink(
          cwd,
          entry,
          async () => {
            assert(roots.length, "roots revoked");
          },
          files,
          source,
        ),
    );
  return {
    dir,
    cwd,
    roots,
    files,
    receiver,
    source,
    begin,
    revoke: () => {
      roots = [];
    },
    close: async () => {
      await receiver.close();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
test("下发多分块校验、同名不覆盖、仅本地 Git 忽略与可复用引用", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.cwd, ".git", "info"), { recursive: true });
    await writeFile(join(f.cwd, ".git", "info", "exclude"), "existing-rule\n");
    const bytes = Buffer.alloc(FILE_CHUNK_SIZE + 57, 97);
    const name = "中文 空格 (图片)[1]#L12";
    const results = [];
    for (let i = 0; i < 2; i++) {
      const t = await f.begin([{ name, size: bytes.length }]);
      await f.receiver.call(
        t.id,
        "write",
        chunk(bytes.subarray(0, FILE_CHUNK_SIZE)),
      );
      await f.receiver.call(
        t.id,
        "write",
        chunk(bytes.subarray(FILE_CHUNK_SIZE), FILE_CHUNK_SIZE),
      );
      const r: any = await f.receiver.call(t.id, "finish", {});
      results.push(attachmentsSchema.parse(r.files)[0]!);
    }
    assert.notEqual(results[0]!.path, results[1]!.path);
    for (const a of results) {
      assert.equal(a.name, name);
      assert.equal(a.sha256, sha(bytes));
      assert.deepEqual(await readFile(join(f.cwd, a.path)), bytes);
      await validateAttachments(f.files, f.source, [a]);
      const text = attachmentMessage("说明", [a]);
      const href = text.match(/\]\(([^)]+)\)/)![1]!;
      assert.equal(classifyFileLink(href).value, a.path);
    }
    const ignore = await readFile(
      join(f.cwd, ".git", "info", "exclude"),
      "utf8",
    );
    assert(ignore.startsWith("existing-rule\n"));
    assert(
      ignore.includes(
        "/" + results[0]!.path.split("/").slice(0, 2).join("/") + "/",
      ),
    );
    assert(!ignore.includes("/attachments/\n"));
    const search = new EnvironmentMentions(
      () => ({ roots: f.roots }),
      async () => [],
    );
    const found = await search.search(f.cwd, "codex", "图片");
    assert.equal(found.items.filter((i) => i.kind === "file").length, 2);
    for (const runtime of ["codex", "claude"] as const) {
      const m = {
        kind: "file" as const,
        name,
        path: results[0]!.path,
        start: 0,
        end: name.length + 1,
      };
      assert.match(nativeMentionText("@" + name, [m], runtime), /^\[/);
    }
    await writeFile(join(f.cwd, results[0]!.path), "changed");
    await assert.rejects(
      validateAttachments(f.files, f.source, [results[0]!]),
      (e: any) => e.code === "FILE_CHANGED",
    );
  } finally {
    await f.close();
  }
});
test("临时材料禁止读取和检索；取消、断连、根目录撤销均清理", async () => {
  const f = await fixture();
  try {
    for (const action of ["cancel", "disconnect", "revoke"] as const) {
      const t = await f.begin([{ name: "pending.txt", size: 2 }]);
      const dir = (await readdir(join(f.cwd, "attachments"))).find((n) =>
        n.startsWith(".relay-upload-"),
      )!;
      await f.receiver.call(t.id, "write", chunk(Buffer.from("a")));
      await assert.rejects(
        f.files.call("files.inspect", {
          source: { ...f.source, path: `attachments/${dir}/pending.txt` },
        }),
        (e: any) => e.code === "UPLOAD_INCOMPLETE",
      );
      const search = new EnvironmentMentions(
        () => ({ roots: f.roots }),
        async () => [],
      );
      assert.equal(
        (await search.search(f.cwd, "codex", "pending.txt")).items.length,
        0,
      );
      await assert.rejects(
        search.validate(f.cwd, "codex", [
          {
            kind: "file",
            name: "pending.txt",
            path: `attachments/${dir}/pending.txt`,
            start: 0,
            end: 12,
          },
        ]),
        (e: any) => e.code === "UPLOAD_INCOMPLETE",
      );
      if (action === "cancel") await f.receiver.cancel(t.id);
      else if (action === "disconnect") await f.receiver.disconnect();
      else {
        f.revoke();
        await assert.rejects(
          f.receiver.call(t.id, "write", chunk(Buffer.from("b"), 1)),
          /revoked/,
        );
      }
      assert.deepEqual(await readdir(join(f.cwd, "attachments")), []);
    }
  } finally {
    await f.close();
  }
});
test("拒绝路径链接、超限、错误顺序/摘要、未完整和落盘篡改", async () => {
  const f = await fixture();
  try {
    for (const entries of [
      [{ name: "../bad", size: 1 }],
      [{ name: "a", size: UPLOAD_FILE_LIMIT + 1 }],
      Array.from({ length: 17 }, () => ({ name: "a", size: 0 })),
      Array.from({ length: 3 }, () => ({ name: "a", size: UPLOAD_FILE_LIMIT })),
    ])
      assert.equal(uploadEntriesSchema.safeParse(entries).success, false);
    await symlink(f.dir, join(f.cwd, "attachments"));
    await assert.rejects(
      f.begin([{ name: "a", size: 1 }]),
      (e: any) => e.code === "UPLOAD_PATH",
    );
    await rm(join(f.cwd, "attachments"));
    await writeFile(join(f.cwd, "attachments"), "keep");
    await assert.rejects(f.begin([{ name: "a", size: 1 }]));
    assert.equal(await readFile(join(f.cwd, "attachments"), "utf8"), "keep");
    await rm(join(f.cwd, "attachments"));
    for (const mode of ["offset", "hash", "incomplete", "tamper"]) {
      const t = await f.begin([{ name: "a", size: 1 }]);
      if (mode === "incomplete")
        await assert.rejects(f.receiver.call(t.id, "finish", {}));
      else if (mode === "tamper") {
        await f.receiver.call(t.id, "write", chunk(Buffer.from("a")));
        const name = (await readdir(join(f.cwd, "attachments")))[0]!;
        await writeFile(join(f.cwd, "attachments", name, "a"), "b");
        await assert.rejects(
          f.receiver.call(t.id, "finish", {}),
          (e: any) => e.code === "UPLOAD_CORRUPT",
        );
      } else
        await assert.rejects(
          f.receiver.call(t.id, "write", {
            ...chunk(Buffer.from("a")),
            ...(mode === "offset" ? { offset: 1 } : { sha256: "0".repeat(64) }),
          }),
        );
      assert.deepEqual(await readdir(join(f.cwd, "attachments")), []);
    }
    const zero = await f.begin([{ name: "empty.txt", size: 0 }]);
    const result: any = await f.receiver.call(zero.id, "finish", {});
    assert.equal(result.files[0].size, 0);
  } finally {
    await f.close();
  }
});
test("通用下发支持非会话目标，登录绑定、在途互斥及授权变更", async () => {
  const receiver = new FilePushReceiver();
  const transfers = new FilePushTransfers();
  let allowed = true,
    aborted = 0;
  const written: Buffer[] = [];
  const peer = {
    call: async (m: string, p: any) => {
      if (m === "files.push.begin") {
        assert.equal(p.destination.kind, "future-use");
        return receiver.begin(
          p.files,
          async () => {},
          async () => ({
            write: async (b: Buffer) => {
              written.push(b);
            },
            finish: async (hash: string) => ({ sha256: hash }),
            abort: async () => {
              aborted++;
            },
          }),
        );
      }
      if (m === "files.push.cancel") return receiver.cancel(p.id);
      const { id, ...data } = p;
      return receiver.call(
        id,
        m === "files.push.write" ? "write" : "finish",
        data,
      );
    },
  } as RpcPeer;
  try {
    const t = await transfers.create(
      "owner",
      {
        peer,
        destination: { kind: "future-use" },
        revalidate() {
          assert(allowed, "revoked");
        },
      },
      [{ name: "a", size: 2 }],
    );
    assert.equal(transfers.busyFor(peer), true);
    await assert.rejects(
      transfers.call("other", t.id, "write", chunk(Buffer.from("a"))),
      (e: any) => e.code === "UPLOAD_EXPIRED",
    );
    await transfers.call("owner", t.id, "write", chunk(Buffer.from("a")));
    allowed = false;
    await assert.rejects(
      transfers.call("owner", t.id, "write", chunk(Buffer.from("b"), 1)),
      /revoked/,
    );
    assert.equal(aborted, 1);
    assert.equal(written.length, 1);
    assert.equal(transfers.busyFor(peer), false);
  } finally {
    await transfers.close();
    await receiver.close();
  }
});

test("认证 HTTP/WSS 下发到真实连接器，首条附件消息防重与离线/归档/撤销门禁", async () => {
  const f = await fixture();
  const local = new Store(join(f.dir, "connector.db"));
  const engine = new Engine(
    local,
    () => ({ roots: f.roots }),
    () => {},
    async () => ({}),
  );
  const { app, store, service } = await createApp({
    dataDir: join(f.dir, "server"),
    publicUrl: "http://localhost",
    secureCookie: false,
  });
  const cookie = randomUUID(),
    other = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  for (const c of [cookie, other])
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(c), "owner", Date.now() + 600000);
  const keys = generateKeyPairSync("ed25519");
  const env = store.put("environments", {
    name: "fixture",
    approved: true,
    revoked: false,
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
  });
  const project = service.save("projects", {
    name: "fixture",
    directories: [{ environmentId: env.id, ...f.source }],
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as any).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/node/connect`);
  const starts: any[] = [];
  const peer = new RpcPeer(
    (v) => ws.send(v),
    async (m, p) => {
      if (m === "identity.challenge")
        return peer.call("identity.authenticate", {
          authVersion: nodeAuthVersion,
          environmentId: env.id,
          signature: sign(
            null,
            Buffer.from(
              nodeProofText(
                p.audience,
                "connect",
                env.id,
                env.publicKey,
                "",
                p.challenge,
              ),
            ),
            keys.privateKey,
          ).toString("base64"),
          protocol: 1,
          capabilities: [
            "file-push-v1",
            "files-v1",
            "mentions-v1",
            "board-attachments-v1",
            "stage-handoff-short-id-v1",
          ],
          roots: f.roots,
          tools: {},
          platform: process.platform + "/" + process.arch,
        });
      // 此桩仅核对派发协议，不冒充实际模型读取或看图。
      if (m === "execution.start") {
        starts.push(p);
        return { status: "completed", stateVersion: 1 };
      }
      if (m.startsWith("files.") || m === "board.attachments.verify")
        return engine.call(m, p);
      return [];
    },
  );
  ws.on("message", (v) => void peer.receive(v.toString()));
  const request = (
    url: string,
    payload: any,
    auth: string = cookie,
    origin = "http://localhost",
  ) =>
    app.inject({
      method: "POST",
      url,
      payload,
      headers: { origin, cookie: `relay_session=${auth}` },
    });
  try {
    for (let i = 0; i < 100 && !service.peers.has(env.id); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert(service.peers.has(env.id));
    const start = randomUUID(),
      done = randomUUID(),
      agent = randomUUID();
    const board = service.save("boards", {
      name: "附件",
      projectId: project.id,
      stages: [
        {
          id: start,
          name: "开始",
          type: "human",
          fixedRole: "start",
          targets: [done, agent],
        },
        {
          id: agent,
          name: "开发",
          type: "agent",
          agentId: service.save("agents", { name: "执行智能体" }).id,
          environmentId: env.id,
          ...f.source,
          targets: [done],
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const beginBoard = (stageId: string, op: string, extra = {}) =>
      request(`/api/boards/${board.id}/uploads`, {
        operationId: op,
        stageId,
        files: [{ name: "说明.txt", size: 4 }],
        ...extra,
      });
    const boardOp = randomUUID();
    const invalid = await beginBoard(agent, boardOp, {
      directory: { environmentId: env.id, rootId: "root", relativePath: ".." },
    });
    assert.equal(invalid.json().code, "DIRECTORY_MISMATCH");
    async function boardFile(stageId: string, op: string, extra = {}) {
      const opened = await beginBoard(stageId, op, extra);
      assert.equal(opened.statusCode, 200, opened.body);
      const path = "/api/file-uploads/" + opened.json().id;
      assert.equal(
        (await request(path + "/write", chunk(Buffer.from("test")))).statusCode,
        200,
      );
      const finished = await request(path + "/finish", {});
      assert.equal(finished.statusCode, 200, finished.body);
      return finished.json();
    }
    const first = await boardFile(start, boardOp);
    const createBody = {
      boardId: board.id,
      title: "需求",
      operationId: boardOp,
      attachmentReceipt: first.attachmentReceipt,
    };
    assert.equal(
      (await request("/api/items", createBody, other)).statusCode,
      403,
    );
    assert.equal(
      (await request("/api/items", { ...createBody, startStageId: agent }))
        .statusCode,
      403,
    );
    const createdItem = await request("/api/items", createBody);
    assert.equal(createdItem.statusCode, 200, createdItem.body);
    const item = createdItem.json();
    assert.equal(item.stageId, start);
    assert.equal((await request("/api/items", createBody)).json().id, item.id);
    const records = () =>
      store.list("handoffs").filter((h) => h.itemId === item.id);
    assert.equal(records().length, 1);
    assert.equal(records()[0]!.kind, "created");
    const saved = records()[0]!.attachments[0];
    assert.equal(saved.environmentId, env.id);
    assert.equal(saved.cwd, f.cwd);
    assert.equal(await readFile(join(saved.cwd, saved.path), "utf8"), "test");
    const editView = () =>
      app.inject({
        method: "GET",
        url: `/api/items/${item.id}/edit`,
        headers: { cookie: `relay_session=${cookie}` },
      });
    const beforeEdit = (await editView()).json();
    const editOp = randomUUID();
    const replacement = await boardFile(start, editOp, {
      itemId: item.id,
      editVersion: item.version,
    });
    const editBody = {
      expectedVersion: item.version,
      expectedStageId: start,
      operationId: editOp,
      title: "修改后的标题",
      content: "修改后的需求",
      removeAttachmentIds: [beforeEdit.attachments[0].referenceId],
      attachmentReceipt: replacement.attachmentReceipt,
    };
    const edit = (payload: any) =>
      app.inject({
        method: "PATCH",
        url: `/api/items/${item.id}`,
        payload,
        headers: {
          origin: "http://localhost",
          cookie: `relay_session=${cookie}`,
        },
      });
    const edited = await edit(editBody);
    assert.equal(edited.statusCode, 200, edited.body);
    assert.deepEqual((await edit(editBody)).json(), edited.json());
    assert.equal(
      (
        await edit({
          ...editBody,
          operationId: randomUUID(),
          attachmentReceipt: undefined,
        })
      ).statusCode,
      409,
    );
    const updated = (await editView()).json();
    assert.equal(updated.item.title, editBody.title);
    assert.equal(updated.item.content, editBody.content);
    assert.equal(updated.item.stageId, start);
    assert.equal(updated.item.executionId, undefined);
    assert.deepEqual(
      updated.attachments.map((a: Attachment) => a.path),
      [replacement.files[0].path],
    );
    assert.equal(records()[0]!.attachments[0].path, saved.path);
    assert.equal(await readFile(join(saved.cwd, saved.path), "utf8"), "test");
    const capabilities = store.get("environments", env.id)
      .capabilities as string[];
    for (const caps of [
      capabilities,
      capabilities.filter((c) => c !== "board-attachments-v1"),
    ]) {
      store.put("environments", { capabilities: caps }, env.id);
      const history = service["dispatchHistory"](item.id, env.id);
      assert.ok(!JSON.stringify(history).includes(saved.path));
      assert.ok(JSON.stringify(history).includes(replacement.files[0].path));
      if (!caps.includes("board-attachments-v1"))
        assert.ok(
          history.some((h) => h.record.includes(replacement.files[0].path)),
        );
    }
    store.put("environments", { capabilities }, env.id);
    const moveOp = randomUUID();
    const move = (attachmentReceipt: string) =>
      request(`/api/items/${item.id}/advance`, {
        operationId: moveOp,
        targetId: done,
        expectedStageId: start,
        expectedVersion: updated.item.version,
        record: "已核对",
        attachmentReceipt,
      });
    const changed = await boardFile(done, moveOp, { itemId: item.id });
    await writeFile(join(f.cwd, changed.files[0].path), "changed");
    assert.equal(
      (await move(changed.attachmentReceipt)).json().code,
      "FILE_CHANGED",
    );
    assert.equal(records().length, 2);
    assert.equal(store.get("items", item.id).stageId, start);
    const nextFile = await boardFile(done, moveOp, { itemId: item.id });
    assert.equal((await move(nextFile.attachmentReceipt)).json().stageId, done);
    assert.equal((await move(nextFile.attachmentReceipt)).json().stageId, done);
    assert.equal(records().length, 3);
    assert.equal(
      records().find((h) => h.to === done)?.attachments[0].path,
      nextFile.files[0].path,
    );
    const agentOp = randomUUID();
    const agentFile = await boardFile(agent, agentOp);
    const agentBody = {
      boardId: board.id,
      title: "开发",
      startStageId: agent,
      operationId: agentOp,
      attachmentReceipt: agentFile.attachmentReceipt,
    };
    const queued = await request("/api/items", agentBody);
    assert.equal(queued.json().status, "queued", queued.body);
    assert.equal(
      (await request("/api/items", agentBody)).json().id,
      queued.json().id,
    );
    await service.tick();
    assert.equal(starts.length, 1);
    const dispatch = starts.pop();
    for (const runtime of ["codex", "claude"] as const) {
      const prompt = workflowPrompt(
        dispatch.workflow,
        dispatch.message,
        runtime,
      );
      assert.ok(prompt.includes(agentFile.files[0].path));
      // 附件历史使用 JSON 表示目录，Windows 反斜杠应按 JSON 字符串校验。
      assert.ok(prompt.includes(JSON.stringify(f.cwd)));
    }
    const session = service.createSession({
      agentId: service.save("agents", { name: "会话智能体" }).id,
      title: "附件测试",
      projectId: project.id,
      environmentId: env.id,
      ...f.source,
      runtime: "codex",
    });
    const create = () =>
      request(`/api/sessions/${session.id}/uploads`, {
        files: [{ name: "真实附件.txt", size: 5 }],
      });
    assert.equal(
      (
        await request(
          `/api/sessions/${session.id}/uploads`,
          { files: [{ name: "a", size: 1 }] },
          "bad",
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          `/api/sessions/${session.id}/uploads`,
          { files: [{ name: "a", size: 1 }] },
          cookie,
          "https://evil.invalid",
        )
      ).statusCode,
      403,
    );
    store.put("environments", { capabilities: ["files-v1"] }, env.id);
    assert.equal((await create()).json().code, "CONNECTOR_UPGRADE");
    store.put(
      "environments",
      { capabilities: ["files-v1", "file-push-v1"] },
      env.id,
    );
    store.put("sessions", { archived: true }, session.id);
    assert.equal((await create()).json().code, "UPLOAD_BLOCKED");
    store.put("sessions", { archived: false, status: "running" }, session.id);
    assert.equal((await create()).json().code, "UPLOAD_BLOCKED");
    store.put("sessions", { status: "idle" }, session.id);
    const created = await create();
    assert.equal(created.statusCode, 200, created.body);
    const id = created.json().id;
    const write = `/api/file-uploads/${id}/write`;
    assert.equal(
      (await request(write, chunk(Buffer.from("hello")), other)).statusCode,
      404,
    );
    assert.equal(
      (await request(write, chunk(Buffer.from("hello")))).statusCode,
      200,
    );
    assert.equal(starts.length, 0);
    const finished = await request(`/api/file-uploads/${id}/finish`, {});
    assert.equal(finished.statusCode, 200, finished.body);
    assert.equal(finished.headers["cache-control"], "no-store");
    const attachments = finished.json().files;
    assert.equal(
      await readFile(join(f.cwd, attachments[0].path), "utf8"),
      "hello",
    );
    const operationId = randomUUID();
    const send = () =>
      request(`/api/sessions/${session.id}/send`, {
        operationId,
        message: "",
        attachments,
      });
    const sent = await send();
    assert.equal(sent.statusCode, 200, sent.body);
    assert.equal((await send()).statusCode, 200);
    assert.equal(starts.length, 1);
    assert.deepEqual(starts[0].attachments, attachments);
    const conflict = await request(`/api/sessions/${session.id}/send`, {
      operationId,
      message: "",
      attachments: [{ ...attachments[0], name: "different.txt" }],
    });
    assert.equal(conflict.json().code, "IDEMPOTENCY_CONFLICT");
    const empty = await request(`/api/sessions/${session.id}/send`, {
      operationId: randomUUID(),
      message: " ",
    });
    assert.equal(empty.json().code, "MESSAGE_EMPTY");
    // 服务端仅存索引和防重摘要，不持久化正文、附件名或字节。
    assert(
      !JSON.stringify(
        store.db.prepare("SELECT * FROM entities").all(),
      ).includes("真实附件.txt"),
    );
    const next = await create();
    assert.equal(next.statusCode, 200, next.body);
    store.put("environments", { revoked: true }, env.id);
    assert.equal(
      (
        await request(
          `/api/file-uploads/${next.json().id}/write`,
          chunk(Buffer.from("hello")),
        )
      ).statusCode,
      403,
    );
    assert(
      !(await readdir(join(f.cwd, "attachments"))).some((n) =>
        n.startsWith(".relay-upload-"),
      ),
    );
    store.put("environments", { revoked: false }, env.id);
    const expired = await create();
    store.db
      .prepare("DELETE FROM auth_sessions WHERE hash=?")
      .run(digest(cookie));
    assert.equal(
      (
        await request(
          `/api/file-uploads/${expired.json().id}/write`,
          chunk(Buffer.from("hello")),
        )
      ).statusCode,
      401,
    );
    ws.terminate();
    await engine.disconnectUploads();
    assert(
      !(await readdir(join(f.cwd, "attachments"))).some((n) =>
        n.startsWith(".relay-upload-"),
      ),
    );
  } finally {
    ws.terminate();
    peer.close();
    await app.close();
    await engine.disconnectUploads();
    engine.close();
    local.close();
    await f.close();
  }
});

/** 协议桩只验证真实适配器收到文件链接和历史记录，不声称供应商已查看图片。 */
test("真实 Codex 适配器收到落盘附件链接，历史和原生请求保留文字及原名", async () => {
  const f = await fixture();
  const local = new Store(join(f.dir, "local.db"));
  const command = join(f.dir, "native-fixture.cjs");
  const capture = join(f.dir, "capture.json");
  const { chmod } = await import("node:fs/promises");
  await writeFile(
    command,
    `#!/usr/bin/env node
const fs = require('node:fs');
const send = x => process.stdout.write(JSON.stringify(x)+'\\n');
require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
 const m=JSON.parse(line); if(m.id===undefined)return;
 if(m.method==='initialize')send({id:m.id,result:{}});
 if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'fixture-thread'}}});
 if(m.method==='thread/read')send({id:m.id,result:{thread:{id:'fixture-thread',turns:[]}}});
 if(m.method==='turn/start'){
  fs.writeFileSync(${JSON.stringify(capture)},JSON.stringify(m.params));
  send({id:m.id,result:{turn:{id:'fixture-turn'}}});
 }
});`,
    "utf8",
  );
  await chmod(command, 0o755);
  const notifications: any[] = [];
  const engine = new Engine(
    local,
    () => ({ roots: f.roots, codex: { command } }),
    (m, p) => notifications.push({ m, p }),
    async () => ({}),
  );
  try {
    const t = await f.begin([{ name: "样例 (1).png", size: 3 }]);
    await f.receiver.call(t.id, "write", chunk(Buffer.from([1, 2, 3])));
    const result: any = await f.receiver.call(t.id, "finish", {});
    const p = {
      operationId: randomUUID(),
      executionId: randomUUID(),
      session: {
        id: randomUUID(),
        title: "fixture",
        ...f.source,
        runtime: "codex",
        permission: "ask",
      },
      message: "请检查文件",
      attachments: result.files,
    };
    await engine.call("execution.start", p);
    const native = JSON.parse(await readFile(capture, "utf8"));
    assert.equal(
      native.input[0].text,
      attachmentMessage(p.message, result.files),
    );
    const user = notifications.find((n) => n.p.event?.type === "user").p.event
      .data;
    assert.equal(user.text, native.input[0].text);
    assert.deepEqual(user.attachments, result.files);
    assert.equal(
      local.get("localExecutions", p.executionId).events[0].data.text,
      user.text,
    );
    const status = await engine.call("execution.start", p);
    assert.equal(status.status, "running");
    await assert.rejects(
      engine.call("execution.start", {
        ...p,
        attachments: [{ ...result.files[0], name: "other" }],
      }),
      (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
    );
  } finally {
    engine.close();
    local.close();
    await f.close();
  }
});

test("下发取消覆盖在途创建与写入，恢复后不继续发布旧传输", async () => {
  const receiver = new FilePushReceiver();
  let release!: () => void;
  let aborted = 0;
  try {
    const opening = receiver.begin(
      [{ name: "a", size: 1 }],
      async () => {},
      async () => {
        await new Promise<void>((r) => {
          release = r;
        });
        return {
          write: async () => {},
          finish: async () => ({}),
          abort: async () => {
            aborted++;
          },
        };
      },
    );
    await new Promise((r) => setImmediate(r));
    await receiver.disconnect();
    release();
    await assert.rejects(opening, (e: any) => e.code === "UPLOAD_EXPIRED");
    assert.equal(aborted, 1);
    const next = await receiver.begin(
      [{ name: "a", size: 1 }],
      async () => {},
      async () => ({
        write: async () =>
          new Promise<void>((r) => {
            release = r;
          }),
        finish: async () => {
          throw Error("must not publish");
        },
        abort: async () => {
          aborted++;
        },
      }),
    );
    const writing = receiver.call(next.id, "write", chunk(Buffer.from("a")));
    await new Promise((r) => setImmediate(r));
    await receiver.cancel(next.id);
    release();
    await assert.rejects(writing, (e: any) => e.code === "UPLOAD_EXPIRED");
    await assert.rejects(
      receiver.call(next.id, "finish", {}),
      (e: any) => e.code === "UPLOAD_EXPIRED",
    );
  } finally {
    await receiver.close();
  }
});

/** 外部替换临时文件不能令校验句柄和最终发布对象分离。 */
test("上传中替换文件为符号链接不会写入外部目标或发布伪附件", async () => {
  const f = await fixture();
  try {
    const outside = join(f.dir, "outside.txt");
    await writeFile(outside, "keep");
    const t = await f.begin([{ name: "a.txt", size: 4 }]);
    const dir = (await readdir(join(f.cwd, "attachments")))[0]!;
    const path = join(f.cwd, "attachments", dir, "a.txt");
    await rm(path);
    await symlink(outside, path);
    await assert.rejects(
      f.receiver.call(t.id, "write", chunk(Buffer.from("evil"))),
      (e: any) => e.code === "UPLOAD_PATH",
    );
    assert.equal(await readFile(outside, "utf8"), "keep");
    assert.deepEqual(await readdir(join(f.cwd, "attachments")), []);
  } finally {
    await f.close();
  }
});
