import { nodeAuthVersion, nodeProofText } from "../src/shared/node-identity.js";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkbenchMarkdown } from "../src/web/workbench-content.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";
import { classifyFileLink, FILE_CHUNK_SIZE } from "../src/shared/files.js";
import {
  EnvironmentFiles,
  normalizeEnvironmentFilePath,
} from "../src/connector/files.js";
import { FileTransfers } from "../src/server/file-transfers.js";
import { createApp } from "../src/server/app.js";
import { digest } from "../src/server/security.js";
import { RpcPeer } from "../src/shared/rpc.js";

/** 临时文件覆盖路径、版本、分块与双端身份，不接触用户工作目录。 */
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "relay-files-"));
  const root = join(dir, "root");
  await mkdir(join(root, "project"), { recursive: true });
  let roots = [{ id: "root", path: root }];
  const reader = new EnvironmentFiles(() => roots);
  const source = {
    rootId: "root",
    relativePath: "project",
    path: "../中文 空格.md",
  };
  await writeFile(join(root, "中文 空格.md"), "安全文本\n".repeat(40000));
  return {
    dir,
    root,
    source,
    reader,
    setRoots: (value: typeof roots) => {
      roots = value;
    },
    close: () => rm(dir, { recursive: true, force: true }),
  };
}
test("链接区分网页与本地路径，兼容盘符、编码和行号并阻止危险协议", () => {
  for (const value of [
    "https://example.com/a.png",
    "http://example.com/test.pdf",
  ])
    assert.equal(classifyFileLink(value).kind, "web");
  for (const value of [
    "javascript:alert(1)",
    "data:text/html,a",
    "//host/a",
    "\\\\host\\share",
    "file://host/a",
    "file:///a%00b",
    "#anchor",
    "https://a:b@example.com/",
  ])
    assert.equal(classifyFileLink(value).kind, "blocked", value);
  assert.deepEqual(
    classifyFileLink("file:///C:/work/%E4%B8%AD%E6%96%87.txt#L12"),
    { kind: "file", value: "C:/work/中文.txt", line: 12 },
  );
  assert.equal(classifyFileLink("C:\\work\\a.ts:12:3").value, "C:\\work\\a.ts");
  assert.equal(classifyFileLink("/app/a.ts#L20-L24").line, 20);
  assert.equal(classifyFileLink("./a%20b.md").value, "./a b.md");
});
test("真实文件分块读取、元信息与修改中断", async () => {
  const f = await fixture();
  try {
    const info: any = await f.reader.call("files.inspect", {
      source: f.source,
    });
    assert.equal(info.kind, "text");
    assert.equal(info.name, "中文 空格.md");
    const chunk: any = await f.reader.call("files.read", {
      source: f.source,
      version: info.version,
      offset: 0,
      length: FILE_CHUNK_SIZE,
    });
    assert.equal(Buffer.from(chunk.data, "base64").length, FILE_CHUNK_SIZE);
    await assert.rejects(
      f.reader.call("files.read", {
        source: f.source,
        version: info.version,
        offset: -1,
        length: 1,
      }),
    );
    await writeFile(join(f.root, "中文 空格.md"), "新版本");
    await assert.rejects(
      f.reader.call("files.read", {
        source: f.source,
        version: info.version,
        offset: 0,
        length: 1,
      }),
      /文件已变化/,
    );
  } finally {
    await f.close();
  }
});
test("环境拒绝越界、符号链接、目录、缺失文件及被撤销工作根目录", async () => {
  const f = await fixture();
  try {
    await writeFile(join(f.dir, "secret.txt"), "outside");
    await symlink(join(f.dir, "secret.txt"), join(f.root, "escape.txt"));
    for (const path of [
      "../../secret.txt",
      "../escape.txt",
      join(f.dir, "secret.txt"),
    ])
      await assert.rejects(
        f.reader.call("files.inspect", { source: { ...f.source, path } }),
        /超出/,
      );
    await assert.rejects(
      f.reader.call("files.inspect", { source: { ...f.source, path: "." } }),
      /普通文件/,
    );
    await assert.rejects(
      f.reader.call("files.inspect", {
        source: { ...f.source, path: "missing" },
      }),
      /不存在/,
    );
    f.setRoots([]);
    await assert.rejects(
      f.reader.call("files.inspect", { source: f.source }),
      /工作根目录不存在/,
    );
  } finally {
    await f.close();
  }
});
test("传输引用绑定登录身份，业务权限变更、取消与损坏分块均失败", async () => {
  const f = await fixture();
  const transfers = new FileTransfers();
  let allowed = true,
    corrupt = false;
  const peer = {
    call: async (m: string, p: any) => {
      const result: any = await f.reader.call(m, p);
      if (corrupt && m === "files.read")
        result.data = Buffer.from("wrong").toString("base64");
      return result;
    },
  } as RpcPeer;
  try {
    const ticket = await transfers.create("owner", {
      peer,
      source: f.source,
      revalidate: () => {
        if (!allowed) throw Error("revoked");
      },
    });
    await assert.rejects(transfers.read("other", ticket.id, 0), /失效/);
    assert.equal(
      (await transfers.read("owner", ticket.id, 0)).length,
      FILE_CHUNK_SIZE,
    );
    allowed = false;
    await assert.rejects(transfers.read("owner", ticket.id, 0), /revoked/);
    allowed = true;
    corrupt = true;
    await assert.rejects(transfers.read("owner", ticket.id, 0), /校验/);
    transfers.cancel("other", ticket.id);
    corrupt = false;
    assert.equal(
      (await transfers.read("owner", ticket.id, 0)).length,
      FILE_CHUNK_SIZE,
    );
    transfers.cancel("owner", ticket.id);
    await assert.rejects(transfers.read("owner", ticket.id, 0), /失效/);
  } finally {
    transfers.close();
    await f.close();
  }
});
test("真实 WebSocket 认证与 HTTP 分块端到端，登录失效和环境撤销停止读取", async () => {
  const f = await fixture();
  const { app, store, service } = await createApp({
    dataDir: join(f.dir, "server"),
    publicUrl: "http://localhost",
    secureCookie: false,
  });
  const cookie = randomUUID(),
    other = randomUUID();
  store.put("users", { username: "fixture" }, "owner");
  for (const value of [cookie, other])
    store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest(value), "owner", Date.now() + 600000);
  const keys = generateKeyPairSync("ed25519");
  const env = store.put("environments", {
    name: "fixture",
    approved: true,
    revoked: false,
    publicKey: keys.publicKey.export({ type: "spki", format: "pem" }),
  });
  const project = service.save("projects", {
    name: "fixture",
    directories: [
      { environmentId: env.id, rootId: "root", relativePath: "project" },
    ],
  });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const port = (app.server.address() as any).port;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/api/node/connect`);
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
          capabilities: ["files-v1"],
          roots: [{ id: "root", path: f.root }],
          tools: {},
          platform: "linux/x64",
        });
      if (m.startsWith("files.")) return f.reader.call(m, p);
      return [];
    },
  );
  ws.on("message", (v) => void peer.receive(v.toString()));
  try {
    for (let i = 0; i < 100 && !service.peers.has(env.id); i++)
      await new Promise((r) => setTimeout(r, 10));
    assert(service.peers.has(env.id));
    const session = service.createSession({
      agentId: service.save("agents", { name: "会话智能体" }).id,
      title: "文件测试会话",
      projectId: project.id,
      environmentId: env.id,
      rootId: "root",
      relativePath: "project",
      runtime: "codex",
    });
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
    assert.equal(
      (
        await request(
          `/api/sessions/${session.id}/files`,
          { href: f.source.path },
          "bad",
        )
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await request(
          `/api/sessions/${session.id}/files`,
          { href: f.source.path },
          cookie,
          "https://attacker.invalid",
        )
      ).statusCode,
      403,
    );
    const meta = await request(`/api/sessions/${session.id}/files`, {
      href: f.source.path,
    });
    assert.equal(meta.statusCode, 200, meta.body);
    const ticket = meta.json();
    const route = `/api/file-transfers/${ticket.id}/read`;
    assert.equal((await request(route, { offset: 0 }, other)).statusCode, 404);
    const chunk = await request(route, { offset: 0 });
    assert.equal(chunk.statusCode, 200, chunk.body);
    assert.equal(chunk.rawPayload.length, FILE_CHUNK_SIZE);
    assert.equal(chunk.headers["cache-control"], "no-store");
    assert.equal(chunk.headers["x-content-type-options"], "nosniff");
    // 同一条已认证 WSS 复用文件通道，为交接上传持久化快照。
    const agentId = randomUUID(),
      doneId = randomUUID();
    const board = service.save("boards", {
      name: "交接上传",
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
          id: agentId,
          name: "执行",
          type: "agent",
          agentId: service.save("agents", { name: "执行智能体" }).id,
          targets: [doneId],
          environmentId: env.id,
          rootId: "root",
          relativePath: "project",
          allowArtifacts: true,
        },
        { id: doneId, name: "完成", type: "done", targets: [] },
      ],
    });
    const item = service.createItem({
      boardId: board.id,
      startStageId: board.stages[1].id,
      title: "提交文件",
    });
    const executionId = store.get("items", item.id).executionId;
    service.setState(executionId, "running");
    const handoff = {
      itemId: item.id,
      executionId,
      operationId: randomUUID(),
      targetId: "S3",
      record: "通过真实传输交付",
      artifacts: [{ path: f.source.path }],
    };
    let result = await peer.call("workflow.handoff", handoff);
    for (let i = 0; result.status === "uploading" && i < 200; i++) {
      await new Promise((r) => setTimeout(r, 10));
      result = await peer.call("workflow.handoff.status", {
        itemId: item.id,
        executionId,
        operationId: handoff.operationId,
      });
    }
    assert.equal(result.stageId, doneId);
    assert.equal(
      (await peer.call("workflow.handoff", handoff)).stageId,
      doneId,
    );
    assert.equal(store.list("handoffs").length, 1);
    assert.equal(store.list("handoffs")[0].artifacts.length, 1);
    store.put("environments", { revoked: true }, env.id);
    assert.equal((await request(route, { offset: 0 })).statusCode, 403);
    store.put("environments", { revoked: false }, env.id);
    store.db
      .prepare("DELETE FROM auth_sessions WHERE hash=?")
      .run(digest(cookie));
    assert.equal((await request(route, { offset: 0 })).statusCode, 401);
  } finally {
    ws.terminate();
    peer.close();
    await app.close();
    await f.close();
  }
});

/** 经过产品实际 Markdown 渲染链路，避免只测未经 URI 编码的裸盘符字符串。 */
test("Windows 盘符链接经 Markdown 编码后仍可点击，URL 盘符和行号正确解析", () => {
  const name = "codex-hir-test-20261111.txt";
  for (const href of [
    "F:\\" + name,
    `F:/${name}`,
    `/F:/${name}`,
    `file:///F:/${name}`,
    `F:%5C${name}%3A12%3A3`,
    `F%3A%5C${name}%23L12`,
  ]) {
    const html = renderToStaticMarkup(
      createElement(WorkbenchMarkdown, {
        text: `[文件](${href})`,
        onFile: () => {},
      }),
    );
    assert.match(html, /class="[^"]*\bfile-link\b[^"]*"/, href);
    const link = classifyFileLink(href);
    assert.equal(link.kind, "file", href);
    assert.match(
      normalizeEnvironmentFilePath(link.value, "win32"),
      /^F:[\\/]codex-hir-test-20261111\.txt$/,
    );
  }
  assert.equal(classifyFileLink(`F:%5C${name}%3A12%3A3`).line, 12);
  for (const href of [
    "javascript%3Aalert(1)",
    "data%3Atext/html,a",
    "%2F%2Fhost/file",
    "%5C%5Chost%5Cfile",
    "file:///x%00y",
  ])
    assert.equal(classifyFileLink(href).kind, "blocked", href);
  for (const path of [
    String.raw`F:\file.txt:secret`,
    String.raw`/F:/file.txt:secret`,
    String.raw`\\?\F:\file.txt`,
    String.raw`\\.\NUL`,
    "F:file.txt",
  ])
    assert.throws(() => normalizeEnvironmentFilePath(path, "win32"));
  assert.equal(
    normalizeEnvironmentFilePath("/F:/" + name, "linux"),
    "/F:/" + name,
  );
});

test("绝对文件跨工作根目录读取不依赖项目，相对路径也按全部根目录授权", async () => {
  const f = await fixture();
  try {
    const second = join(f.dir, "second"),
      sibling = join(f.dir, "second-extra");
    await mkdir(second);
    await mkdir(sibling);
    await writeFile(join(second, "outside-project.txt"), "跨根目录文件");
    await writeFile(join(sibling, "denied.txt"), "not allowed");
    f.setRoots([
      { id: "root", path: f.root },
      { id: "second", path: second },
    ]);
    for (const source of [
      { ...f.source, path: join(second, "outside-project.txt") },
      { ...f.source, path: "../../second/outside-project.txt" },
      {
        rootId: "deleted-project-root",
        relativePath: "missing-project",
        path: join(second, "outside-project.txt"),
      },
    ]) {
      const info: any = await f.reader.call("files.inspect", { source });
      const chunk: any = await f.reader.call("files.read", {
        source,
        version: info.version,
        offset: 0,
        length: 256,
      });
      assert.equal(
        Buffer.from(chunk.data, "base64").toString("utf8"),
        "跨根目录文件",
      );
    }
    await assert.rejects(
      f.reader.call("files.inspect", {
        source: { ...f.source, path: join(sibling, "denied.txt") },
      }),
      /超出/,
    );
    await assert.rejects(
      f.reader.call("files.inspect", {
        source: { ...f.source, relativePath: "missing", path: "relative.txt" },
      }),
      /不存在/,
    );
    f.setRoots([{ id: "root", path: f.root }]);
    await assert.rejects(
      f.reader.call("files.inspect", {
        source: { ...f.source, path: join(second, "outside-project.txt") },
      }),
      /超出/,
    );
  } finally {
    await f.close();
  }
});

/** 在途元信息只阻塞所属连接；全局容量及同连接并发计数仍有效。 */
test("文件查询与更新按环境互斥，失败释放名额", async () => {
  const f = await fixture();
  const transfers = new FileTransfers();
  const pending: Array<{
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }> = [];
  const peer = {
    call: () =>
      new Promise((resolve, reject) => pending.push({ resolve, reject })),
  } as unknown as RpcPeer;
  const other = {} as RpcPeer;
  const grant = { peer, source: f.source, revalidate() {} };
  try {
    const first = transfers.create("owner", grant);
    const second = transfers.create("owner", grant);
    assert.equal(transfers.busyFor(peer), true);
    assert.equal(transfers.busyFor(other), false);
    assert.equal(transfers.busyFor(undefined), false);
    const failed = assert.rejects(first, /inspect failed/);
    pending[0]!.reject(new Error("inspect failed"));
    await failed;
    assert.equal(transfers.busyFor(peer), true);
    pending[1]!.resolve(
      await f.reader.call("files.inspect", { source: f.source }),
    );
    const ticket = await second;
    assert.equal(transfers.busyFor(peer), true);
    transfers.cancel("owner", ticket.id);
    assert.equal(transfers.busyFor(peer), false);
    const openings = Array.from({ length: 64 }, () =>
      transfers.create("owner", grant),
    );
    const settled = Promise.allSettled(openings);
    await assert.rejects(
      transfers.create("owner", { ...grant, peer: other }),
      (error: any) => error.code === "TRANSFER_LIMIT",
    );
    for (const waiting of pending.slice(2))
      waiting.reject(new Error("inspect failed"));
    await settled;
    assert.equal(transfers.busyFor(peer), false);
  } finally {
    transfers.close();
    await f.close();
  }
});
