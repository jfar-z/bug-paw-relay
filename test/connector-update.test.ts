import { execFileSync } from "node:child_process";
import { readConnectorRelease } from "../src/server/connector-release.js";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  symlinkSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync, crc32 } from "node:zlib";
import { Store } from "../src/server/store.js";
import { Service } from "../src/server/service.js";
import { Vault } from "../src/server/security.js";
import { ConnectorUpdates } from "../src/server/connector-updates.js";
import { extractUpdate, archivePath } from "../src/connector/update-archive.js";
import {
  installRoot,
  readRecoveryUpdate,
  claimInstallation,
  activeUpdate,
  atomicJson,
  installationStatus,
  journalPath,
  applicationRoot,
  setApplication,
  saveUpdate,
  type LocalUpdate,
} from "../src/connector/update-installation.js";
import { recoverUpdateBeforeWorker } from "../src/connector/updater.js";
import { Engine } from "../src/connector/engine.js";
import { createApp } from "../src/server/app.js";
import {
  currentUpdateCompatibility,
  type UpdateTarget,
} from "../src/shared/connector-update.js";
import { connectorStorageError } from "../src/shared/connector-storage-errors.js";
import type { RpcPeer } from "../src/shared/rpc.js";

const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const target: UpdateTarget = {
  version: "0.1.0-aaaaaaaaaaaa",
  buildId: "a".repeat(40),
  platform: "linux",
  arch: "x64",
  file: "bugpaw-relay-0.1.0-aaaaaaaaaaaa-linux-x64.tar.gz",
  size: 7,
  sha256: hash(Buffer.from("package")),
  updateProtocol: 3,
  dataFormat: 2,
  compatibility: currentUpdateCompatibility,
};
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-update-")),
    web = join(dir, "web");
  mkdirSync(join(web, "downloads"), { recursive: true });
  writeFileSync(join(web, "downloads", target.file), "package");
  writeFileSync(
    join(web, "downloads/release.json"),
    JSON.stringify({
      version: target.version,
      revision: target.buildId,
      updateProtocol: 3,
      dataFormat: 2,
      compatibility: currentUpdateCompatibility,
      releases: [target],
    }),
  );
  const store = new Store(join(dir, "state.db")),
    service = new Service(store, new Vault(dir)),
    updates = new ConnectorUpdates(service, web);
  const env = store.put("environments", {
    approved: true,
    revoked: false,
    connectorVersion: "0.1.0-old",
    platform: "linux/x64",
    capabilities: ["connector-update-v3"],
    connectorBuildId: "b".repeat(40),
    updateInstallation: {
      managed: true,
      current: {
        updateProtocol: 3,
        dataFormat: 2,
        compatibility: currentUpdateCompatibility,
      },
    },
  });
  // 测试替身保留网络不确定性，不声称完成真实安装。
  const peer = {
    call: async () => {
      throw new Error("offline");
    },
  } as unknown as RpcPeer;
  service.peers.set(env.id, peer);
  const request = {
    operationId: randomUUID(),
    expectedCurrentVersion: "0.1.0-old",
    targetVersion: target.version,
    targetSha256: target.sha256,
  };
  return {
    dir,
    web,
    store,
    service,
    updates,
    env,
    peer,
    request,
    close() {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("更新账本冻结目标、防重、环境唯一锁及跨实体 ID 保护", async () => {
  const f = fixture();
  try {
    assert.throws(
      () => f.updates.start(f.env.id, { ...f.request, operationId: f.env.id }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    assert.equal(f.store.get("environments", f.env.id).approved, true);
    assert.throws(
      () =>
        f.updates.start(f.env.id, {
          ...f.request,
          targetSha256: "b".repeat(64),
        }),
      { code: "TARGET_CHANGED" },
    );
    const first = f.updates.start(f.env.id, f.request);
    assert.equal(f.updates.start(f.env.id, f.request).id, first.id);
    assert.throws(
      () =>
        f.updates.start(f.env.id, {
          ...f.request,
          targetVersion: "0.1.0-other",
        }),
      { code: "IDEMPOTENCY_CONFLICT" },
    );
    assert.throws(
      () =>
        f.updates.start(f.env.id, { ...f.request, operationId: randomUUID() }),
      { code: "UPDATE_IN_PROGRESS" },
    );
    assert.equal(f.service.updating(f.env.id), true);
    const session = f.store.put("sessions", {
      environmentId: f.env.id,
      archived: false,
    });
    await assert.rejects(f.service.send(session.id, randomUUID(), "不得启动"), {
      code: "UPDATE_IN_PROGRESS",
    });
    const queued = randomUUID();
    f.store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(queued, randomUUID(), session.id, f.env.id, "queued", "{}", "now");
    await f.service.tick();
    assert.equal(f.service.execution(queued).state, "queued");
    assert.throws(() =>
      f.store.put("connectorUpdates", {
        environmentId: f.env.id,
        state: "accepted",
      }),
    );
    const restored = new ConnectorUpdates(
      new Service(f.store, f.service.vault),
      f.web,
    );
    assert.equal(restored.active(f.env.id)?.target.sha256, target.sha256);
  } finally {
    f.close();
  }
});

test("资格阻止旧节点、未知版本、离线、撤销、忙碌与不完整发行", () => {
  const f = fixture();
  try {
    assert.equal(f.updates.view(f.env.id).eligible, true);
    const manifestPath = join(f.web, "downloads/release.json");
    const original = readFileSync(manifestPath, "utf8");
    writeFileSync(
      manifestPath,
      JSON.stringify({
        ...JSON.parse(original),
        dataFormat: 99,
      }),
    );
    assert.ok(
      readConnectorRelease(f.web),
      "不兼容自动更新的包仍可由用户人工下载",
    );
    assert.equal(f.updates.view(f.env.id).eligible, false);
    writeFileSync(manifestPath, original);
    for (const [patch, code] of [
      [{ capabilities: [] }, "UPDATE_UNSUPPORTED"],
      [{ connectorVersion: null }, "UPDATE_UNSUPPORTED"],
      [{ revoked: true }, "REVOKED"],
      [{ updateInstallation: { managed: false } }, "UNMANAGED_INSTALL"],
      [{ connectorVersion: target.version }, "ALREADY_CURRENT"],
    ] as const) {
      const old = f.store.get("environments", f.env.id);
      f.store.put("environments", patch, f.env.id);
      assert.equal(f.updates.view(f.env.id).blockedReason, code);
      f.store.put("environments", old, f.env.id);
    }
    f.service.peers.clear();
    assert.equal(f.updates.view(f.env.id).blockedReason, "ENVIRONMENT_OFFLINE");
    f.service.peers.set(f.env.id, f.peer);
    f.store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(randomUUID(), null, randomUUID(), f.env.id, "waiting", "{}", "now");
    assert.throws(() => f.updates.start(f.env.id, f.request), {
      code: "ENVIRONMENT_BUSY",
    });
    f.store.db.prepare("DELETE FROM executions").run();
    writeFileSync(
      join(f.web, "downloads/release.json"),
      JSON.stringify({
        version: target.version,
        releases: [
          { platform: target.platform, arch: target.arch, file: target.file },
        ],
      }),
    );
    assert.equal(f.updates.view(f.env.id).blockedReason, "PACKAGE_UNAVAILABLE");
  } finally {
    f.close();
  }
});

test("本地引擎探测失败保留原因并释放准备阶段维护锁", async () => {
  const f = fixture();
  try {
    f.peer.call = async () => {
      throw connectorStorageError("ENGINE_UNAVAILABLE");
    };
    const operation = f.updates.start(f.env.id, f.request);
    await new Promise((resolve) => setImmediate(resolve));
    const failed = f.updates.get(f.env.id, operation.id);
    assert.equal(failed.state, "failed");
    assert.equal(failed.errorCode, "ENGINE_UNAVAILABLE");
    assert.equal(f.updates.active(f.env.id), undefined);
  } finally {
    f.close();
  }
});

test("节点授权绑定用途、环境、操作、摘要、有效期并在撤销后失效", async () => {
  const f = fixture();
  try {
    f.updates.start(f.env.id, f.request);
    const grant = f.updates.issue(f.env.id, f.request.operationId);
    const auth = "Bearer " + grant.grant;
    assert.equal(
      (await f.updates.packageFile(auth, f.request.operationId)).size,
      7,
    );
    assert.throws(() => f.updates.verify(auth, randomUUID()), {
      code: "DOWNLOAD_EXPIRED",
    });
    assert.throws(() => f.updates.verify(undefined, f.request.operationId), {
      code: "DOWNLOAD_UNAUTHORIZED",
    });
    const seal = (data: unknown) =>
      "Bearer " +
      Buffer.from(
        f.service.vault.seal(JSON.stringify(data)),
        "base64",
      ).toString("base64url");
    assert.throws(
      () =>
        f.updates.verify(
          seal({
            purpose: "release-download",
            operationId: f.request.operationId,
            expiresAt: Date.now() + 10000,
          }),
          f.request.operationId,
        ),
      { code: "DOWNLOAD_EXPIRED" },
    );
    assert.throws(
      () =>
        f.updates.verify(
          seal({
            purpose: "connector-update",
            operationId: f.request.operationId,
            expiresAt: 1,
          }),
          f.request.operationId,
        ),
      { code: "DOWNLOAD_EXPIRED" },
    );
    writeFileSync(join(f.web, "downloads", target.file), "changed");
    await assert.rejects(f.updates.packageFile(auth, f.request.operationId), {
      code: "PACKAGE_UNAVAILABLE",
    });
    f.store.put("environments", { revoked: true }, f.env.id);
    assert.throws(() => f.updates.verify(auth, f.request.operationId), {
      code: "DOWNLOAD_UNAUTHORIZED",
    });
  } finally {
    f.close();
  }
});

test("旧进程不能报告成功，新身份版本及构建对账后确认，乱序不回退", async () => {
  const f = fixture();
  try {
    f.updates.start(f.env.id, f.request);
    let confirms = 0;
    const peer = {
      call: async () => {
        confirms++;
        return { ok: true };
      },
    } as unknown as RpcPeer;
    const report = {
      operationId: f.request.operationId,
      target,
      state: "reconciling",
      lastConfirmedState: "reconciling",
      stateVersion: 10,
      downloadedBytes: 7,
      actualVersion: target.version,
      actualBuildId: target.buildId,
      errorCode: null,
    };
    await f.updates.report(f.env.id, report, peer);
    assert.equal(confirms, 0);
    assert.equal(f.updates.active(f.env.id)?.state, "reconciling");
    f.store.put(
      "environments",
      { connectorVersion: target.version, connectorBuildId: target.buildId },
      f.env.id,
    );
    await f.updates.report(f.env.id, { ...report, stateVersion: 11 }, peer);
    assert.equal(confirms, 1);
    assert.equal(f.updates.active(f.env.id), undefined);
    await f.updates.report(
      f.env.id,
      { ...report, stateVersion: 9, state: "downloading" },
      peer,
    );
    assert.equal(
      f.updates.get(f.env.id, f.request.operationId).state,
      "succeeded",
    );
  } finally {
    f.close();
  }
});

/** 构造真实 tar/ZIP 格式，仅使用合成正文，便于逐条覆盖危险归档。 */
function tar(entries: { name: string; type?: string; body?: string }[]) {
  const parts: Buffer[] = [];
  for (const e of entries) {
    const h = Buffer.alloc(512),
      data = Buffer.from(e.body || "");
    h.write(e.name, 0, 100);
    h.write("0000644\0", 100);
    h.write(data.length.toString(8).padStart(11, "0") + "\0", 124);
    h.fill(32, 148, 156);
    h.write(e.type || "0", 156);
    h.write("ustar\0", 257);
    h.write(
      [...h]
        .reduce((a, b) => a + b, 0)
        .toString(8)
        .padStart(6, "0") + "\0 ",
      148,
    );
    parts.push(h, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  return gzipSync(Buffer.concat([...parts, Buffer.alloc(1024)]));
}
function zip(name: string, body: string, mode = 0o100644) {
  const n = Buffer.from(name),
    data = Buffer.from(body),
    local = Buffer.alloc(30),
    central = Buffer.alloc(46),
    end = Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(crc32(data), 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(n.length, 26);
  central.writeUInt32LE(0x02014b50);
  central.writeUInt16LE(0x314, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(crc32(data), 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(n.length, 28);
  central.writeUInt32LE((mode * 65536) >>> 0, 38);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + n.length, 12);
  end.writeUInt32LE(local.length + n.length + data.length, 16);
  return Buffer.concat([local, n, data, central, n, end]);
}

test("真实 tar/ZIP 解包拒绝穿越、绝对路径、ADS、链接、设备、别名和截断", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-archive-"));
  try {
    for (const name of [
      "../x",
      "/x",
      "C:/x",
      "//host/x",
      "root/a:b",
      "root/a\\b",
      "root/CON.txt",
      "root/COM¹.txt",
      "root/CONOUT$",
      "root/a.",
      "root/../x",
      "root/a\0b",
    ])
      assert.throws(() => archivePath(name), { code: "UNSAFE_ARCHIVE" });
    for (const platform of ["linux", "windows"] as const) {
      const bytes =
        platform === "linux"
          ? tar([{ name: "root/空 格.txt", body: "内容" }])
          : zip("root/空 格.txt", "内容");
      const result = extractUpdate(
        bytes,
        join(dir, platform),
        "root",
        platform,
      );
      assert.equal(readFileSync(join(result, "空 格.txt"), "utf8"), "内容");
      assert.throws(
        () =>
          extractUpdate(
            bytes.subarray(0, bytes.length - 12),
            join(dir, "truncated" + platform),
            "root",
            platform,
          ),
        { code: "UNSAFE_ARCHIVE" },
      );
    }
    for (const type of ["1", "2", "3", "4", "6"])
      assert.throws(
        () =>
          extractUpdate(
            tar([{ name: "root/link", type }]),
            join(dir, "type" + type),
            "root",
            "linux",
          ),
        { code: "UNSAFE_ARCHIVE" },
      );
    for (const entries of [
      [{ name: "root/../escape" }],
      [{ name: "root/A" }, { name: "root/a" }],
      [{ name: "root/a" }, { name: "root/a/b" }],
      [{ name: "root/A/x" }, { name: "root/a/y" }],
    ])
      assert.throws(
        () =>
          extractUpdate(tar(entries), join(dir, randomUUID()), "root", "linux"),
        { code: "UNSAFE_ARCHIVE" },
      );
    assert.throws(
      () =>
        extractUpdate(
          zip("root/link", "../secret", 0o120777),
          join(dir, "link"),
          "root",
          "windows",
        ),
      { code: "UNSAFE_ARCHIVE" },
    );
    assert.equal(existsSync(join(dir, "escape")), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("数据与应用物理隔离、指针越界拒绝及下载断电恢复保留原版", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-install-")),
    root = join(dir, "安装 空间"),
    data = join(dir, "data"),
    project = join(dir, "project");
  const oldRoot = process.env.BUGPAW_INSTALL_ROOT;
  try {
    delete process.env.BUGPAW_INSTALL_ROOT;
    assert.equal(installRoot(), process.cwd());
    mkdirSync(join(root, "app/dist/connector"), { recursive: true });
    mkdirSync(join(root, "runtime"));
    mkdirSync(data);
    mkdirSync(project);
    writeFileSync(join(root, "runtime", process.platform === "win32" ? "node.exe" : "node"), "runtime");
    writeFileSync(
      join(root, "app/dist/connector/release.json"),
      JSON.stringify({
        updateProtocol: 1,
        dataFormat: 1,
        rollbackCompatible: true,
      }),
    );
    assert.equal(
      installationStatus(data, [{ path: project }], root).managed,
      true,
    );
    claimInstallation(data, root);
    assert.throws(() => claimInstallation(project, root), {
      code: "UNMANAGED_INSTALL",
    });
    assert.equal(installationStatus(project, [], root).managed, false);
    assert.equal(
      installationStatus(join(root, "runtime"), [], root).managed,
      false,
    );
    assert.equal(
      installationStatus(data, [{ path: join(root, "app") }], root).managed,
      false,
    );
    symlinkSync(join(root, "runtime"), join(dir, "linked-data"));
    assert.equal(
      installationStatus(join(dir, "linked-data"), [], root).managed,
      false,
    );
    const id = randomUUID();
    const o: LocalUpdate = {
      operationId: id,
      target,
      expectedCurrentVersion: "0.1.0-old",
      previous: root,
      state: "downloading",
      lastConfirmedState: "downloading",
      stateVersion: 1,
      downloadedBytes: 3,
      actualVersion: "0.1.0-old",
      actualBuildId: null,
      errorCode: null,
    };
    atomicJson(journalPath(id, root), o);
    process.env.BUGPAW_INSTALL_ROOT = root;
    assert.equal(activeUpdate()?.operationId, id);
    recoverUpdateBeforeWorker();
    assert.equal(activeUpdate(), null);
    assert.equal(
      JSON.parse(readFileSync(journalPath(id, root), "utf8")).state,
      "failed",
    );
    atomicJson(journalPath(id, root), { ...o, state: "recovery_required" });
    assert.equal(recoverUpdateBeforeWorker(), null);
    assert.equal(activeUpdate()?.state, "recovery_required");
    atomicJson(journalPath(id, root), { ...o, state: "failed" });
    assert.equal(applicationRoot(root), root);
    assert.throws(() => setApplication(data, root), {
      code: "RECOVERY_REQUIRED",
    });
    writeFileSync(join(root, ".relay-update/current.txt"), "../data\n");
    assert.throws(() => applicationRoot(root), { code: "RECOVERY_REQUIRED" });
  } finally {
    if (oldRoot === undefined) delete process.env.BUGPAW_INSTALL_ROOT;
    else process.env.BUGPAW_INSTALL_ROOT = oldRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("环境执行门闩阻止更新中启动、文件读取与目录写入，对账仍可读取", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-gate-")),
    oldRoot = process.env.BUGPAW_INSTALL_ROOT;
  const store = new Store(":memory:"),
    engine = new Engine(
      store,
      () => ({ roots: [] }),
      () => {},
      async () => ({}),
    );
  try {
    process.env.BUGPAW_INSTALL_ROOT = dir;
    mkdirSync(join(dir, ".relay-update"));
    const o: LocalUpdate = {
      operationId: randomUUID(),
      target,
      expectedCurrentVersion: "0.1.0-old",
      previous: dir,
      state: "prechecking",
      lastConfirmedState: "prechecking",
      stateVersion: 0,
      downloadedBytes: 0,
      actualVersion: null,
      actualBuildId: null,
      errorCode: null,
    };
    atomicJson(journalPath(o.operationId), o);
    for (const method of [
      "execution.start",
      "execution.prepare",
      "execution.startPrepared",
      "files.read",
      "directory.create",
    ])
      await assert.rejects(engine.call(method, {}), {
        code: "UPDATE_IN_PROGRESS",
      });
    assert.equal(
      (await engine.call("execution.status", { executionId: randomUUID() }))
        .status,
      "not_found",
    );
    saveUpdate(o, { state: "failed" });
    assert.equal(activeUpdate(), null);
  } finally {
    engine.close();
    store.close();
    if (oldRoot === undefined) delete process.env.BUGPAW_INSTALL_ROOT;
    else process.env.BUGPAW_INSTALL_ROOT = oldRoot;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("HTTP 更新接口需登录及同源，节点包入口不接受浏览器 Origin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-update-http-")),
    f = await createApp({
      dataDir: dir,
      publicUrl: "http://127.0.0.1",
      secureCookie: false,
    });
  try {
    const id = randomUUID();
    assert.equal(
      (
        await f.app.inject({
          method: "POST",
          url: `/api/environments/${id}/connector-updates`,
          headers: { origin: "http://127.0.0.1" },
          payload: {},
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "GET",
          url: `/api/environments/${id}/connector-updates/${randomUUID()}`,
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "GET",
          url: `/api/node/connector-updates/${randomUUID()}/package`,
          headers: { origin: "http://127.0.0.1" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (
        await f.app.inject({
          method: "GET",
          url: `/api/node/connector-updates/${randomUUID()}/package`,
        })
      ).statusCode,
      403,
    );
  } finally {
    await f.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 真实源码 CLI 也必须使用用户指定目录，不能误跳转普通 dist 或默认用户目录。 */
test("源码 CLI 保留显式数据目录且不会误判完整安装", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-cli-home-"));
  try {
    const output = execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "src/connector/main.ts",
        "status",
        "--data-home",
        dir,
      ],
      { encoding: "utf8" },
    );
    const status = JSON.parse(output);
    assert.equal(status.dataDirectory, dir);
    assert.equal(status.running, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 声明比较不依赖格式白名单，未知语义保持拒绝。 */
test("协议三兼容矩阵覆盖持久化契约与旧引导拒绝", async () => {
  const {
    currentUpdateCompatibility: base,
    updateCompatibilityReason: reason,
  } = await import("../src/shared/connector-update.js");
  const current = { updateProtocol: 3, dataFormat: 2, compatibility: base };
  const next = { ...target, ...current, rollbackCompatible: true };
  assert.equal(reason(current, next), null);
  for (const format of [3, 19, 2030]) {
    const future = {
      ...current,
      dataFormat: format,
      compatibility: {
        ...base,
        ledger: { format, contract: `future-ledger-${format}` },
      },
    };
    assert.equal(reason(future, { ...next, ...future }), null);
  }
  assert.equal(reason(null, next), "BOOTSTRAP_REQUIRED");
  assert.equal(
    reason(current, { ...next, updateProtocol: 99 }),
    "UPDATE_PROTOCOL_UNSUPPORTED",
  );
  assert.equal(
    reason(current, { ...next, compatibility: undefined }),
    "COMPATIBILITY_UNKNOWN",
  );
  assert.equal(
    reason(current, { ...next, compatibility: { ...base, schema: 99 } }),
    "COMPATIBILITY_UNKNOWN",
  );
  assert.equal(
    reason(current, { ...next, dataFormat: 1 }),
    "COMPATIBILITY_CONFLICT",
  );
  assert.equal(
    reason(current, {
      ...next,
      dataFormat: 1,
      compatibility: { ...base, ledger: { ...base.ledger, format: 1 } },
    }),
    "DATA_FORMAT_INCOMPATIBLE",
  );
  assert.equal(
    reason(current, {
      ...next,
      compatibility: { ...base, preservesData: false },
    }),
    "DATA_FORMAT_INCOMPATIBLE",
  );
  for (const domain of ["ledger", "config", "journal"] as const)
    assert.equal(
      reason(current, {
        ...next,
        compatibility: {
          ...base,
          [domain]: { ...base[domain], contract: "incompatible" },
        },
      }),
      "DATA_FORMAT_INCOMPATIBLE",
    );
});

test("旧更新协议不能继续执行或接受回滚确认", async () => {
  const f = fixture();
  try {
    const operation = f.updates.start(f.env.id, f.request);
    await assert.rejects(
      f.updates.report(
        f.env.id,
        {
          operationId: operation.id,
          target: operation.target,
          state: "rollback_reconciling",
          lastConfirmedState: "rollback_reconciling",
          stateVersion: 5,
          downloadedBytes: 7,
          actualVersion: f.request.expectedCurrentVersion,
          actualBuildId: "b".repeat(40),
          errorCode: null,
        },
        {
          call: async () => {
            throw new Error("must not call");
          },
        } as unknown as RpcPeer,
      ),
    );
    for (const protocol of [1, 2]) {
      assert.equal(
        (
          await import("../src/shared/connector-update.js")
        ).updateCompatibilityReason(
          { updateProtocol: protocol, dataFormat: 2 },
          { ...target, updateProtocol: protocol },
        ),
        "UPDATE_PROTOCOL_UNSUPPORTED",
      );
    }
    assert.equal(f.service.updating(f.env.id), true);
  } finally {
    f.close();
  }
});

test("只读复核实际账本格式，不通过目标启动迁移探测", async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const { installedUpdateFacts } =
    await import("../src/connector/update-installation.js");
  const { currentUpdateCompatibility } =
    await import("../src/shared/connector-update.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-format-"));
  try {
    mkdirSync(join(dir, "app/dist/connector"), { recursive: true });
    writeFileSync(
      join(dir, "app/dist/connector/release.json"),
      JSON.stringify({
        updateProtocol: 3,
        dataFormat: 2,
        compatibility: currentUpdateCompatibility,
      }),
    );
    const db = new DatabaseSync(join(dir, "environment.db"));
    db.exec(
      "PRAGMA user_version=2; CREATE TABLE evidence(value TEXT); INSERT INTO evidence VALUES('preserved');",
    );
    assert.equal(installedUpdateFacts(dir, dir).dataFormat, 2);
    db.exec("PRAGMA user_version=3");
    assert.throws(() => installedUpdateFacts(dir, dir), {
      code: "ACTUAL_FORMAT_MISMATCH",
    });
    assert.equal(
      db.prepare("SELECT value FROM evidence").get()!.value,
      "preserved",
    );
    assert.equal(db.prepare("PRAGMA user_version").get()!.user_version, 3);
    db.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("损坏兼容元数据仍保留发行目标并明确拒绝", async () => {
  const {
    currentUpdateCompatibility: compatibility,
    updateCompatibilityReason,
  } = await import("../src/shared/connector-update.js");
  const current = { updateProtocol: 3, dataFormat: 2, compatibility };
  assert.equal(
    updateCompatibilityReason(current, {
      ...current,
      compatibility: { ...compatibility, schema: 99 },
    }),
    "COMPATIBILITY_UNKNOWN",
  );
  const f = fixture();
  try {
    const path = join(f.web, "downloads/release.json");
    const release = JSON.parse(readFileSync(path, "utf8"));
    writeFileSync(
      path,
      JSON.stringify({
        ...release,
        updateProtocol: "unknown",
        compatibility: { schema: 99 },
      }),
    );
    assert.equal(f.updates.view(f.env.id).target?.version, target.version);
    assert.equal(
      f.updates.view(f.env.id).blockedReason,
      "UPDATE_PROTOCOL_UNSUPPORTED",
    );
    writeFileSync(
      path,
      JSON.stringify({
        ...release,
        updateProtocol: 3,
        dataFormat: 2,
        compatibility,
      }),
    );
    f.store.put(
      "environments",
      {
        updateInstallation: {
          managed: false,
          blockedReason: "UNMANAGED_INSTALL",
        },
      },
      f.env.id,
    );
    assert.equal(f.updates.view(f.env.id).blockedReason, "UNMANAGED_INSTALL");
  } finally {
    f.close();
  }
});

/** 人工恢复是独立终态，不能伪装原目标成功或被迟到回滚回执覆盖。 */
test("人工安装恢复必须匹配认证构建，旧回执不重新加锁", async () => {
  const f = fixture();
  try {
    const o = f.updates.start(f.env.id, f.request);
    f.store.put(
      "environments",
      {
        capabilities: ["connector-update-v3"],
        connectorVersion: "0.1.0-manual",
        connectorBuildId: "c".repeat(40),
      },
      f.env.id,
    );
    const report = {
      operationId: o.id,
      target: o.target,
      state: "recovered",
      lastConfirmedState: "recovered",
      stateVersion: 20,
      downloadedBytes: 0,
      actualVersion: "0.1.0-manual",
      actualBuildId: "d".repeat(40),
      errorCode: null,
    };
    await assert.rejects(f.updates.report(f.env.id, report, f.peer), {
      code: "RECOVERY_REQUIRED",
    });
    const recovered = await f.updates.report(
      f.env.id,
      { ...report, actualBuildId: "c".repeat(40) },
      f.peer,
    );
    assert.equal(recovered.state, "recovered");
    assert.equal(recovered.actualVersion, "0.1.0-manual");
    assert.equal(f.service.updating(f.env.id), false);
    await assert.rejects(
      f.updates.report(
        f.env.id,
        { ...report, state: "rolling_back", stateVersion: 99 },
        f.peer,
      ),
    );
    assert.equal(f.updates.get(f.env.id, o.id).state, "recovered");
  } finally {
    f.close();
  }
});

/** 同一数据目录的切换归属不依赖安装根，手工启动必须等待监督器退出。 */
test("跨安装目录启动遵守数据目录切换锁，死进程锁不永久阻塞", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-switch-lock-"));
  const store = new Store(join(dir, "environment.db"), false, 2);
  try {
    store.db.exec(
      "CREATE TABLE connector_switch(singleton INTEGER PRIMARY KEY,pid INTEGER,operation_id TEXT)",
    );
    store.db
      .prepare("INSERT INTO connector_switch VALUES(1,?,?)")
      .run(process.pid, randomUUID());
    assert.throws(() => recoverUpdateBeforeWorker(dir), {
      code: "UPDATE_IN_PROGRESS",
    });
    store.db.exec("UPDATE connector_switch SET pid=2147483647");
    assert.equal(recoverUpdateBeforeWorker(dir), null);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 手工指定旧安装只提供核验来源，不执行旧程序，也不修改原始更新记录。 */
test("跨目录恢复核验数据归属与监督器存活，保留原日志", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-legacy-recovery-"));
  const root = join(dir, "old"),
    data = join(dir, "data");
  mkdirSync(join(root, ".relay-update"), { recursive: true });
  mkdirSync(data);
  writeFileSync(
    join(root, ".relay-update/installation.json"),
    JSON.stringify({ dataDirectory: data }),
  );
  const id = randomUUID();
  const record = {
    operationId: id,
    target,
    expectedCurrentVersion: "0.1.0-old",
    previous: root,
    state: "recovery_required",
    lastConfirmedState: "restarting",
    stateVersion: 3,
    downloadedBytes: 7,
    actualVersion: "0.1.0-old",
    actualBuildId: null,
    errorCode: "RECOVERY_REQUIRED",
    supervisorPid: process.pid,
  };
  try {
    atomicJson(journalPath(id, root), record);
    assert.throws(() => readRecoveryUpdate(id, data, root), {
      code: "UPDATE_IN_PROGRESS",
    });
    const previousRoot = process.env.BUGPAW_PREVIOUS_INSTALL_ROOT;
    try {
      process.env.BUGPAW_PREVIOUS_INSTALL_ROOT = root;
      assert.throws(() => recoverUpdateBeforeWorker(data), {
        code: "UPDATE_IN_PROGRESS",
      });
    } finally {
      if (previousRoot === undefined)
        delete process.env.BUGPAW_PREVIOUS_INSTALL_ROOT;
      else process.env.BUGPAW_PREVIOUS_INSTALL_ROOT = previousRoot;
    }
    record.supervisorPid = 2147483647;
    atomicJson(journalPath(id, root), record);
    assert.equal(readRecoveryUpdate(id, data, root)?.recoverySourceRoot, root);
    assert.deepEqual(
      JSON.parse(readFileSync(journalPath(id, root), "utf8")),
      record,
    );
    assert.throws(() => readRecoveryUpdate(id, root, root), {
      code: "UNMANAGED_INSTALL",
    });
    writeFileSync(
      join(root, ".relay-update/supervisor.lock"),
      String(process.pid),
    );
    assert.throws(() => readRecoveryUpdate(id, data, root), {
      code: "UPDATE_IN_PROGRESS",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("更新占用按执行合并两端账本，定向终止须有节点终态，保留看板历史", async () => {
  const f = fixture();
  const db = new Store(join(f.dir, "node.db"));
  const engine = new Engine(db, () => ({ roots: [] }), () => {}, async () => ({}));
  const updates = new ConnectorUpdates(f.service, f.web, () => true);
  try {
    const cap = "connector-update-blockers-v1";
    f.store.put("environments", { capabilities: [cap] }, f.env.id);
    const item = f.store.put("items", { title: "已完成的工作", stageId: "done" });
    function seed(name: string, server: string, interaction: object) {
      const project = f.store.put("projects", { name });
      const session = f.store.put("sessions", { environmentId: f.env.id, projectId: project.id, title: "同名" });
      const executionId = randomUUID();
      f.store.db.prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)").run(
        executionId, item.id, session.id, f.env.id, server, '{"stage":{"name":"开发"}}', "now",
      );
      db.put("localExecutions", { sessionId: session.id, status: "waiting",
        interactions: [{ id: randomUUID(), ...interaction }], questionRecords: [{ status: "waiting" }] }, executionId);
      return { sessionId: session.id, executionId };
    }
    const one = seed("第一项目", "completed", { question: { text: "私有正文" } });
    const two = seed("第二项目", "waiting", { approval: { kind: "permission" } });
    let stops = 0;
    (engine as any).handles.set(one.executionId, {
      cancel: async () => {
        stops++;
        setTimeout(() => (engine as any).state(one.executionId, "cancelled"), 10);
      },
      close() {},
    });
    f.peer.call = (method, params) => engine.call(method, params);
    const list = await updates.blockers(f.env.id);
    assert.equal(list.nodeDetails, "available");
    assert.deepEqual(list.reasons, ["transfer"]);
    assert.equal(list.executions.length, 2);
    assert.equal(JSON.stringify(list).includes("私有正文"), false);
    const first = list.executions.find(row => row.executionId === one.executionId)!;
    assert.equal(first.projectName, "第一项目");
    assert.equal(first.itemTitle, item.title);
    assert.equal(first.stageName, "开发");
    assert.equal(first.waitingFor, "answer");
    assert.equal(first.serverStatus, "completed");
    assert.equal(first.canStop, true);
    assert.equal(list.executions.find(row => row.executionId === two.executionId)?.waitingFor, "approval");
    await assert.rejects(updates.stopBlocker(f.env.id, { ...one, sessionId: two.sessionId }), { code: "NOT_FOUND" });
    await assert.rejects(engine.call("connector.update.stopBlocker", { ...one, sessionId: two.sessionId }), { code: "NOT_FOUND" });
    assert.deepEqual(await updates.stopBlocker(f.env.id, one), { outcome: "ended", status: "cancelled" });
    assert.equal(f.service.execution(one.executionId).state, "completed");
    assert.deepEqual(f.store.get("items", item.id), item);
    assert.equal(db.get("localExecutions", one.executionId).questionRecords[0].status, "invalidated");
    assert.equal(db.get("localExecutions", two.executionId).status, "waiting");
    assert.deepEqual((await updates.blockers(f.env.id)).executions.map(row => row.executionId), [two.executionId]);
    const next = db.put("localExecutions", { sessionId: one.sessionId, status: "running" });
    assert.deepEqual(await updates.stopBlocker(f.env.id, one), { outcome: "alreadyEnded", status: "cancelled" });
    assert.equal(stops, 1);
    assert.equal(db.get("localExecutions", next.id).status, "running");
    f.peer.call = async method => {
      if (method === "connector.update.stopBlocker") return { outcome: "requested" };
      throw Object.assign(new Error("断线"), { code: "OFFLINE" });
    };
    await assert.rejects(updates.stopBlocker(f.env.id, two), { code: "OFFLINE" });
    assert.equal((await updates.blockers(f.env.id)).nodeDetails, "unavailable");
    // 上一版支持按执行号对账和取消，即使看板已完成，也能处理仍在等待的会话。
    f.store.put("environments", { capabilities: ["connector-update-v3"] }, f.env.id);
    f.store.put("sessions", { executionId: one.executionId, status: "waiting" }, one.sessionId);
    db.put("localExecutions", { status: "waiting" }, one.executionId);
    f.peer.call = (method, params) => engine.call(method, params);
    const partial = await updates.blockers(f.env.id);
    assert.equal(partial.nodeDetails, "unsupported");
    assert.equal(partial.executions.find(row => row.executionId === one.executionId)?.canStop, true);
    assert.deepEqual(await updates.stopBlocker(f.env.id, one), { outcome: "ended", status: "cancelled" });
    assert.equal(db.get("localExecutions", next.id).status, "running");
    f.store.put("environments", { capabilities: [] }, f.env.id);
    const legacy = await updates.blockers(f.env.id);
    assert.equal(legacy.nodeDetails, "unsupported");
    assert.equal(legacy.executions[0].canStop, false);
    await assert.rejects(updates.stopBlocker(f.env.id, two), { code: "UPDATE_UNSUPPORTED" });
    f.store.put("environments", { revoked: true }, f.env.id);
    await assert.rejects(updates.blockers(f.env.id), { code: "REVOKED" });
  } finally {
    engine.close();
    db.close();
    f.close();
  }
});
