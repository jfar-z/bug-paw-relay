import {
  mkdtempSync,
  rmSync,
  readFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { createHash, randomBytes, verify } from "node:crypto";
/** 从实际归档解压验收，隔离用户数据，覆盖无系统 Node、空格路径及后台启停。 */
const temporary = mkdtempSync(join(tmpdir(), "relay portable "));
let child;
let server;
try {
  const metadata = JSON.parse(
    readFileSync("dist/portable/release.json", "utf8"),
  );
  // 校验归档内真实 PE 子系统，防止登录入口被误编译为控制台程序。
  const windows = metadata.releases.find(r => r.platform === "windows" && r.arch === "x64");
  assert.ok(windows);
  const windowsArchive = resolve("dist/portable", windows.file);
  const windowsRoot = windows.file.replace(/\.zip$/, "");
  for (const [exe, subsystem] of [["bugpaw-relay-login.exe", 2], ["bugpaw-relay.exe", 3]]) {
    const bytes = execFileSync("unzip", ["-p", windowsArchive, windowsRoot + "/" + exe]);
    const pe = bytes.readUInt32LE(0x3c);
    assert.equal(bytes.toString("ascii", pe, pe + 4), "PE\0\0");
    assert.equal(bytes.readUInt16LE(pe + 4), 0x8664);
    assert.equal(bytes.readUInt16LE(pe + 24 + 68), subsystem);
  }
  assert.deepEqual(
    execFileSync("unzip", ["-p", windowsArchive, windowsRoot + "/windows-autostart.ps1"]),
    readFileSync("packaging/windows-autostart.ps1"),
  );
  const release = metadata.releases.find(
    (r) => r.platform === "linux" && r.arch === "x64",
  );
  assert.ok(
    release &&
      /^bugpaw-relay-[a-zA-Z0-9.-]+-linux-x64\.tar\.gz$/.test(release.file),
  );
  const archive = resolve("dist/portable", release.file);
  assert.equal(
    createHash("sha256").update(readFileSync(archive)).digest("hex"),
    release.sha256,
  );
  execFileSync("tar", ["-xzf", archive, "-C", temporary]);
  const root = join(temporary, release.file.replace(/\.tar\.gz$/, "")),
    launcher = join(root, "bugpaw-relay");
  // 实际归档内的版本读取结果必须与服务端下载清单完全一致。
  const reportedVersion = execFileSync(
    join(root, "runtime/node"),
    [
      "--input-type=module",
      "-e",
      "import { readConnectorVersion } from './app/dist/connector/version.js'; console.log(readConnectorVersion());",
    ],
    { cwd: root, encoding: "utf8" },
  ).trim();
  assert.equal(reportedVersion, metadata.version);
  const env = {
    ...process.env,
    PATH: "/usr/bin:/bin",
    BUGPAW_HOME: join(temporary, "user data"),
  };
  assert.match(
    execFileSync(launcher, ["--help"], { env, encoding: "utf8" }),
    /BugPaw Relay/,
  );
  const status = JSON.parse(
    execFileSync(launcher, ["status"], { env, encoding: "utf8" }),
  );
  assert.equal(status.running, false);
  // 归档验收使用同包协议构造器，并真实验证连接器生成的注册签名。
  const { nodeProofText, registrationDigest } = await import(
    join(root, "app/dist/shared/node-identity.js")
  );
  const challenges = new Map();
  server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const input = JSON.parse(Buffer.concat(chunks).toString() || "{}");
    const audience = `http://127.0.0.1:${server.address().port}`;
    if (req.url === "/api/node/challenge") {
      const challenge = randomBytes(32).toString("base64url");
      challenges.set(challenge, registrationDigest(input));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ challenge, authVersion: 2, audience }));
    } else if (req.url === "/api/node/register") {
      assert.equal(input.authVersion, 2);
      assert.equal(challenges.get(input.challenge), registrationDigest(input));
      assert.ok(
        verify(
          null,
          Buffer.from(
            nodeProofText(
              audience,
              "register",
              "",
              input.publicKey,
              registrationDigest(input),
              input.challenge,
            ),
          ),
          input.publicKey,
          Buffer.from(input.signature, "base64"),
        ),
      );
      challenges.delete(input.challenge);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: "portable-test" }));
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  child = spawn(launcher, ["web", "--no-open"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(Error("Web startup timeout")), 10000);
    child.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\/#\S+/);
      if (match) {
        clearTimeout(timer);
        resolve(new URL(match[0]));
      }
    });
    child.on("error", reject);
  });
  const base = url.origin,
    headers = {
      Authorization: "Bearer " + url.hash.slice(1),
      "Content-Type": "application/json",
      Origin: base,
    };
  async function api(path, data, extra = {}) {
    const response = await fetch(base + "/api/" + path, {
      method: data ? "POST" : "GET",
      headers: { ...headers, ...extra },
      body: data ? JSON.stringify(data) : undefined,
    });
    return { response, data: await response.json() };
  }
  assert.equal((await fetch(base + "/api/config")).status, 400);
  assert.equal(
    (await api("start", {}, { Origin: "https://evil.invalid" })).response
      .status,
    400,
  );
  assert.match(await (await fetch(base)).text(), /工作根目录/);
  const brand = await fetch(base + "/assets/brand.png");
  assert.equal(brand.status, 200);
  assert.equal(brand.headers.get("content-type"), "image/png");
  const config = (await api("config")).data;
  config.serverUrl = `http://127.0.0.1:${server.address().port}`;
  config.roots = [{ id: "work", path: temporary }];
  config.codex.apiKey = "fixture-only-key";
  assert.equal((await api("config", config)).response.status, 200);
  assert.equal((await api("config")).data.codex.apiKey, "");
  assert.equal((await api("config")).data.codex.hasKey, true);
  assert.ok(
    !readFileSync(join(env.BUGPAW_HOME, "config.json"), "utf8").includes(
      "fixture-only-key",
    ),
  );
  assert.equal(
    (await api("register", { code: "fixture-invite" })).response.status,
    200,
  );
  assert.equal((await api("status")).data.running, true);
  assert.equal((await api("config", config)).response.status, 400);
  assert.equal((await api("start", {})).response.status, 200);
  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  child = null;
  assert.equal(
    JSON.parse(execFileSync(launcher, ["status"], { env, encoding: "utf8" }))
      .running,
    true,
  );
  execFileSync(launcher, ["stop"], { env });
  assert.equal(
    JSON.parse(execFileSync(launcher, ["status"], { env, encoding: "utf8" }))
      .running,
    false,
  );
  const modules = join(root, "app/node_modules");
  assert.equal(existsSync(join(modules, "@openai/codex")), false);
  assert.equal(existsSync(join(modules, "@anthropic-ai/claude-agent-sdk")), false);
  assert.ok(
    (!existsSync(join(modules, "@anthropic-ai")) || !readdirSync(join(modules, "@anthropic-ai")).some((name) =>
      name.startsWith("claude-agent-sdk-"),
    )),
  );
  console.log(
    "PASS: portable archive, external CLI packaging, Web auth/config/register, background lifecycle, CLI and paths with spaces",
  );
} finally {
  child?.kill("SIGTERM");
  server?.closeAllConnections();
  server?.close();
  rmSync(temporary, { recursive: true, force: true });
}
