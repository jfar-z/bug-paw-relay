import { DatabaseSync } from "node:sqlite";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
  renameSync,
  rmSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { createApp } from "../dist/server/app.js";
import { ConnectorConfig } from "../dist/connector/config.js";
import { workerStatus, stopWorker } from "../dist/connector/process.js";
import { extractUpdate } from "../dist/connector/update-archive.js";
import { ConnectorStore } from "../dist/connector/store.js";
import { digest } from "../dist/server/security.js";

/** 真实 Linux 进程与 HTTP/WSS 更新验收；身份、项目和版本变体均为隔离合成数据。 */
const packages = process.argv[2] || "dist/portable";
const manifest = JSON.parse(
  readFileSync(join(packages, "release.json"), "utf8"),
);
const directory = mkdtempSync(join(tmpdir(), "relay-update-e2e-"));
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 120000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await fn()) return;
    await sleep(250);
  }
  throw new Error("等待更新状态超时");
}
let app, settings, browser, page;
try {
  const release = manifest.releases.find((r) => r.platform === "linux");
  const root = extractUpdate(
    readFileSync(join(packages, release.file)),
    join(directory, "安装 空格"),
    "bugpaw-relay-" + manifest.version + "-linux-x64",
    "linux",
  );
  // 未来格式测试提供真实 SQLite 读写实现变体，绝非只伪造元信息；不作为产品格式支持。
  const futureFormat = process.env.RELAY_TEST_FUTURE_FORMAT === "3";
  if (futureFormat) {
    manifest.dataFormat = 3;
    manifest.compatibility.ledger = { format: 3, contract: "test-ledger-v3" };
    const metadataPath = join(root, "app/dist/connector/release.json");
    writeFileSync(
      metadataPath,
      JSON.stringify({
        ...JSON.parse(readFileSync(metadataPath, "utf8")),
        dataFormat: 3,
        compatibility: manifest.compatibility,
      }),
    );
    const storePath = join(root, "app/dist/connector/store.js");
    const source = readFileSync(storePath, "utf8");
    assert.ok(source.includes("super(path, false, 2)"));
    assert.ok(source.includes("PRAGMA user_version=2"));
    writeFileSync(
      storePath,
      source
        .replace("super(path, false, 2)", "super(path, false, 3)")
        .replace("PRAGMA user_version=2", "PRAGMA user_version=3"),
    );
  }
  // ZIP 同样使用生产解包器逐条验证，但不替代 Windows 实机启动。
  const windows = manifest.releases.find((r) => r.platform === "windows");
  extractUpdate(
    readFileSync(join(packages, windows.file)),
    join(directory, "windows"),
    "bugpaw-relay-" + manifest.version + "-windows-x64",
    "windows",
  );
  console.log("真实 Linux tar.gz 与 Windows ZIP 安全解包通过");
  const web = join(directory, "web"),
    downloads = join(web, "downloads"),
    data = join(directory, "用户 数据"),
    project = join(directory, "项目 .git");
  cpSync("dist/web", web, { recursive: true });
  mkdirSync(downloads, { recursive: true });
  mkdirSync(project);
  writeFileSync(join(project, "sentinel.txt"), "用户代码不得改变");
  const stage = join(directory, "stage");
  mkdirSync(stage);
  const executionId = randomUUID(),
    sessionId = randomUUID(),
    operationId = randomUUID(),
    handoffId = randomUUID();
  let stageRoot = join(stage, "initial");
  cpSync(root, stageRoot, { recursive: true });
  function publish(letter, broken = false) {
    const revision = letter.repeat(40),
      version = (futureFormat ? "7.0.0-" : "0.1.0-") + revision.slice(0, 12),
      folder = "bugpaw-relay-" + version + "-linux-x64";
    const next = join(stage, folder);
    renameSync(stageRoot, next);
    stageRoot = next;
    const metadata = {
      version,
      revision,
      platform: "linux",
      arch: "x64",
      updateProtocol: manifest.updateProtocol,
      compatibility: manifest.compatibility,
      dataFormat: manifest.dataFormat,
      rollbackCompatible: manifest.rollbackCompatible,
    };
    writeFileSync(
      join(next, "app/dist/connector/release.json"),
      JSON.stringify(metadata),
    );
    cpSync(
      join(root, "app/dist/connector/main.js"),
      join(next, "app/dist/connector/main.js"),
    );
    if (broken)
      writeFileSync(
        join(next, "app/dist/connector/main.js"),
        broken === "write"
          ? `import { ConnectorStore } from './store.js';
             import { join } from 'node:path';
             const db = new ConnectorStore(join(process.env.BUGPAW_HOME, 'environment.db'));
             const previous = db.get('localExecutions', '${executionId}');
             db.put('localExecutions', { sequence: 2, events: [...previous.events, { sequence: 2, text: 'committed-before-failure' }] }, previous.id);
             db.close(); process.exit(1);`
          : "process.exit(1);",
      );
    const file = folder + ".tar.gz",
      path = join(downloads, file);
    execFileSync("tar", ["--format=gnu", "-czf", path, "-C", stage, folder]);
    const bytes = readFileSync(path),
      item = {
        platform: "linux",
        arch: "x64",
        file,
        size: bytes.length,
        sha256: hash(bytes),
      };
    writeFileSync(
      join(downloads, "release.json"),
      JSON.stringify({ ...metadata, releases: [item] }),
    );
    return { version, ...item };
  }
  let expected = publish("b");
  const options = {
    dataDir: join(directory, "server"),
    publicUrl: "http://127.0.0.1",
    webDir: web,
    secureCookie: false,
  };
  const instance = await createApp(options);
  app = instance.app;
  await app.listen({ host: "127.0.0.1", port: 0 });
  options.publicUrl += ":" + app.server.address().port;
  const keys = generateKeyPairSync("ed25519");
  const publicKey = keys.publicKey
    .export({ type: "spki", format: "pem" })
    .toString();
  const environment = instance.store.put("environments", {
    approved: true,
    revoked: false,
    name: "隔离更新验收",
    publicKey,
  });
  settings = new ConnectorConfig(data);
  settings.save({
    serverUrl: options.publicUrl,
    name: "隔离更新验收",
    environmentId: environment.id,
    publicKey,
    privateKey: settings.vault.seal(
      keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    ),
    roots: [{ id: "workspace", path: project }],
  });
  const ledger = new ConnectorStore(join(data, "environment.db"));
  ledger.put(
    "localSessions",
    { title: "preserved", runtime: "codex" },
    sessionId,
  );
  ledger.put(
    "localExecutions",
    {
      sessionId,
      operationId,
      handoffOperationId: handoffId,
      status: "completed",
      sequence: 1,
      events: [{ sequence: 1, text: "committed-before-update" }],
    },
    executionId,
  );
  // 接近真实故障节点的历史规模，更新健康检查不得重复装载这些正文。
  ledger.transaction(() => {
    const insert = ledger.db.prepare("INSERT INTO local_events VALUES(?,?,?)");
    for (let execution = 0; execution < 80; execution++) {
      const id = `history-${execution}`;
      ledger.put(
        "localExecutions",
        {
          sessionId,
          status: "completed",
          sequence: 1000,
          events: [],
        },
        id,
      );
      for (let sequence = 1; sequence <= 1000; sequence++)
        insert.run(
          id,
          sequence,
          JSON.stringify({ sequence, text: "history".repeat(100) }),
        );
    }
  });
  if (futureFormat) ledger.db.exec("PRAGMA user_version=3");
  ledger.close();
  const userHome = join(directory, "原生用户目录");
  mkdirSync(join(userHome, ".codex/sessions"), { recursive: true });
  mkdirSync(join(userHome, ".claude/projects"), { recursive: true });
  const nativeFiles = [
    ".codex/auth.json",
    ".codex/sessions/fixture.jsonl",
    ".claude/projects/fixture.jsonl",
  ];
  for (const file of nativeFiles)
    writeFileSync(join(userHome, file), "synthetic-user-data-only");
  const preserved = new Map(
    ["config.json", "master.key"]
      .filter((n) => existsSync(join(data, n)))
      .map((n) => [n, hash(readFileSync(join(data, n)))]),
  );
  instance.store.put("users", { username: "fixture" }, "owner");
  const cookie = randomUUID();
  instance.store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 3600000);
  const child = spawn(
    join(root, "runtime/node"),
    [join(root, "app/dist/connector/main.js"), "run"],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        HOME: userHome,
        BUGPAW_HOME: data,
        BUGPAW_INSTALL_ROOT: root,
      },
    },
  );
  child.on("error", (e) => {
    throw e;
  });
  await waitFor(() => instance.service.peers.has(environment.id));
  // 可选页面驱动模式使用真实发行包、连接器及认证链路，不拦截更新接口。
  if (process.env.RELAY_TEST_BROWSER === "1") {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({
      executablePath: process.env.RELAY_TEST_CHROMIUM,
      args: ["--no-sandbox"],
    });
    const context = await browser.newContext({ locale: "zh-CN" });
    await context.addCookies([
      { name: "relay_session", value: cookie, url: options.publicUrl },
    ]);
    page = await context.newPage();
  }
  async function update(current, target, result) {
    let id = randomUUID();
    if (page) {
      await page.goto(options.publicUrl + "/#environments");
      const trigger = page.locator(".connector-update-actions button").first();
      await trigger.click();
      const dialog = page.getByRole("dialog");
      assert.ok((await dialog.textContent()).includes(target.version));
      const accepted = page.waitForResponse(
        (r) =>
          r.request().method() === "POST" &&
          r.url().endsWith("/connector-updates"),
      );
      await dialog
        .getByRole("button", { name: "确认下发", exact: true })
        .click();
      const response = await accepted;
      assert.equal(response.status(), 202);
      id = (await response.json()).id;
      await page.reload();
    } else {
      const response = await app.inject({
        method: "POST",
        url: `/api/environments/${environment.id}/connector-updates`,
        headers: {
          origin: options.publicUrl,
          cookie: "relay_session=" + cookie,
        },
        payload: {
          operationId: id,
          expectedCurrentVersion: current,
          targetVersion: target.version,
          targetSha256: target.sha256,
        },
      });
      assert.equal(response.statusCode, 202, response.body);
    }
    if (result === "recovery_required") {
      await waitFor(
        () =>
          !instance.service.peers.has(environment.id) &&
          instance.store.get("connectorUpdates", id).state === "restarting",
      );
      instance.store.put(
        "connectorUpdates",
        { updatedAt: new Date(0).toISOString() },
        id,
      );
      // Store 自动维护更新时间，直接设置测试时钟夹具以免真实等待三分钟。
      instance.store.db
        .prepare(
          "UPDATE entities SET body=json_set(body,'$.updatedAt',?) WHERE id=?",
        )
        .run(new Date(0).toISOString(), id);
      await instance.connectorUpdates?.poll?.();
      // 定时轮询使用上述已过期观察窗口；不修改产品超时。
    }
    await waitFor(
      () => instance.store.get("connectorUpdates", id).state === result,
      180000,
    );
    const o = instance.store.get("connectorUpdates", id);
    if (page) {
      const { expect } = await import("@playwright/test");
      await expect(
        page.getByText(result === "succeeded" ? "更新成功" : "待恢复，请检查本机状态", {
          exact: true,
        }),
      ).toBeVisible({ timeout: 15000 });
      await expect(page.getByText(id, { exact: false })).toBeVisible();
      console.log("真实页面确认、刷新及终态通过：" + result);
    }
    for (const file of nativeFiles)
      assert.equal(
        readFileSync(join(userHome, file), "utf8"),
        "synthetic-user-data-only",
      );
    assert.equal(o.downloadedBytes, target.size);
    for (const [file, sha] of preserved)
      assert.equal(hash(readFileSync(join(data, file))), sha);
    assert.equal(
      readFileSync(join(project, "sentinel.txt"), "utf8"),
      "用户代码不得改变",
    );
    const { ConnectorStore: CompatibleStore } = await import(
      join(root, "app/dist/connector/store.js")
    );
    const ledger = new CompatibleStore(join(data, "environment.db"));
    const execution = ledger.get("localExecutions", executionId);
    assert.equal(execution.status, "completed");
    assert.equal(execution.operationId, operationId);
    assert.equal(execution.handoffOperationId, handoffId);
    assert.equal(
      ledger.executionEvents(executionId)[0].text,
      "committed-before-update",
    );
    assert.equal(ledger.get("localSessions", sessionId).title, "preserved");
    ledger.close();
    return o;
  }
  await update(manifest.version, expected, "succeeded");
  console.log("A→B：真实认证重连、下载、切换、健康确认通过");
  expected = publish("c");
  await update(
    (futureFormat ? "7.0.0-" : "0.1.0-") + "b".repeat(12),
    expected,
    "succeeded",
  );
  console.log("B→C：第二次远程更新成功，无手工替换；配置与项目摘要保持");
  const current = (futureFormat ? "7.0.0-" : "0.1.0-") + "c".repeat(12);
  if (futureFormat) {
    console.log(
      "未来格式 3 的真实 SQLite 读写变体：跨应用主版本 A→B→C 通过；不是产品格式 3 交付",
    );
  }
  expected = publish("e", "write");
  const failed = await update(current, expected, "recovery_required");
  // 观察超时不是候选已退出的证据；等待注入写入落盘，避免与新进程启动竞态。
  await waitFor(() => {
    // 观察者必须只读；反复构造存储会执行启动写事务，与故障注入争锁。
    // 候选启动会短暂持有 SQLite 锁；只读观察使用现有有限等待，不把争锁当作业务失败。
    const probe = new DatabaseSync(join(data, "environment.db"), { readOnly: true, timeout: 5000 });
    try {
      return probe.prepare("SELECT json_extract(body,'$.sequence') AS sequence FROM entities WHERE kind='localExecutions' AND id=?").get(executionId)?.sequence === 2;
    } finally {
      probe.close();
    }
  });
  const afterFailure = new ConnectorStore(join(data, "environment.db"));
  assert.equal(afterFailure.get("localExecutions", executionId).sequence, 2);
  assert.equal(
    afterFailure.executionEvents(executionId)[1].text,
    "committed-before-failure",
  );
  afterFailure.close();
  assert.equal((await workerStatus(settings)).running, false);
  assert.equal(existsSync(join(root, ".relay-update/supervisor.lock")), false);
  assert.equal(
    readFileSync(join(root, ".relay-update/current.txt"), "utf8").includes(
      failed.id,
    ),
    true,
  );
  console.log(
    "候选提交后退出：未回滚、未循环重启，监督进程退出，已提交数据保留",
  );
  expected = publish("f");
  const manualRoot = extractUpdate(
    readFileSync(join(downloads, expected.file)),
    join(directory, "manual"),
    "bugpaw-relay-" + expected.version + "-linux-x64",
    "linux",
  );
  const manual = spawn(
    join(manualRoot, "runtime/node"),
    [join(manualRoot, "app/dist/connector/main.js"), "run"],
    {
      stdio: "ignore",
      env: {
        ...process.env,
        HOME: userHome,
        BUGPAW_HOME: data,
        BUGPAW_INSTALL_ROOT: manualRoot,
      },
    },
  );
  manual.on("error", (error) => {
    throw error;
  });
  await waitFor(
    () =>
      instance.store.get("connectorUpdates", failed.id).state === "recovered",
  );
  assert.equal(
    instance.store.get("connectorUpdates", failed.id).actualVersion,
    expected.version,
  );
  assert.equal(
    (await workerStatus(settings)).connectorVersion,
    expected.version,
  );
  assert.equal(instance.service.updating(environment.id), false);
  console.log(
    "人工完整安装 F：原身份接入、旧操作按实际构建恢复，不重放 E 更新",
  );
} finally {
  if (browser) await browser.close();
  if (settings) await stopWorker(settings).catch(() => {});
  if (app) await app.close();
  rmSync(directory, { recursive: true, force: true });
}
