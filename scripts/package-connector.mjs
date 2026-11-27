import { currentUpdateCompatibility } from "../dist/shared/connector-update.js";
import {
  mkdirSync,
  rmSync,
  cpSync,
  writeFileSync,
  readFileSync,
  existsSync,
  statSync,
  chmodSync,
  readdirSync,
  lstatSync,
  realpathSync,
  unlinkSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, join, relative, isAbsolute, sep } from "node:path";
/** 构建目标平台独立发行包，校验官方 Node 下载，不复制用户数据或开发依赖。 */
// 预发构建沿用带提交后缀的版本；正式包也记录完整提交，供在线更新核验。
const previewRevision = process.env.RELAY_BUILD_REVISION;
const revision = previewRevision || process.env.RELAY_SOURCE_REVISION ||
  execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
if (!/^[a-f0-9]{40}$/.test(revision))
  throw Error("构建提交标识无效");
const baseVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const version = baseVersion + (previewRevision ? "-" + revision.slice(0, 12) : ""),
  nodeVersion = "24.19.0",
  cache = resolve(".vibe/portable-cache"),
  output = resolve("dist/portable");
mkdirSync(cache, { recursive: true });
mkdirSync(output, { recursive: true });
const hash = (file) =>
  createHash("sha256").update(readFileSync(file)).digest("hex");
function download(name) {
  const target = join(cache, name);
  if (!existsSync(target))
    execFileSync(
      "curl",
      [
        "-fL",
        "--retry",
        "3",
        "--connect-timeout",
        "20",
        `https://nodejs.org/dist/v${nodeVersion}/${name}`,
        "-o",
        target,
      ],
      { stdio: "inherit" },
    );
  return target;
}
const sums = readFileSync(download("SHASUMS256.txt"), "utf8");
const releases = [];
// 薄更新能力独立协商，旧节点需完整安装一次。
const packageMessages = {
  "connector.package.storageUpgrade": {
    "zh-CN":
      "本版使用协议三薄更新和有界事件缓存。旧节点须正常停止并备份，按存储说明完成一次性数据过渡后完整安装一次；请解压到新的独立应用目录，用原用户和原 BUGPAW_HOME 启动，保留身份、配置和数据库，切勿混用新旧文件。默认数据目录为用户目录下 .bugpaw-relay；自定义目录须显式传入。后续更新不自动备份或回滚，启动失败请重新安装最新兼容完整包。启用过自启动时检查并更新已有启动入口，不新增自启动。完整说明见 CONNECTOR-UPDATES.md。\n",
    en: "This build uses protocol 3 thin updates and bounded event caches. Before installation, older nodes require the one-time data preparation described in the storage guide and a normal shutdown. Extract to a new independent application directory and start as the original user with the original BUGPAW_HOME, preserving identity, configuration and database. Never mix old and new application files. The default data directory is .bugpaw-relay under the user home; explicitly pass custom directories. Updates do not automatically back up or roll back. If startup fails, reinstall the latest compatible full package. Check and update any existing autostart entry; do not enable new autostart. See CONNECTOR-UPDATES.md.\n",
  },
};
for (const platform of ["linux", "windows"]) {
  const os = platform === "windows" ? "win32" : "linux",
    nodeName = `node-v${nodeVersion}-${platform === "windows" ? "win" : "linux"}-x64`,
    nodeArchive = nodeName + (platform === "windows" ? ".zip" : ".tar.xz");
  const runtimeArchive = download(nodeArchive);
  const expected = sums
    .split("\n")
    .find((line) => line.endsWith("  " + nodeArchive))
    ?.split(" ")[0];
  if (hash(runtimeArchive) !== expected)
    throw Error("Node SHA256 mismatch: " + nodeArchive);
  const stage = join(cache, platform),
    folder = `bugpaw-relay-${version}-${platform}-x64`,
    root = join(stage, folder),
    app = join(root, "app");
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(app, { recursive: true });
  for (const name of ["package.json", "package-lock.json"])
    cpSync("packaging/connector/" + name, join(app, name));
  execFileSync(
    "npm",
    [
      "ci",
      "--omit=dev",
      "--omit=optional",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      `--os=${os}`,
      "--cpu=x64",
    ],
    { cwd: app, stdio: "inherit" },
  );
  // 只分发目标架构的终端原生模块，保留 Windows ConPTY 的配套运行文件。
  const ptyRoot = join(app, "node_modules/node-pty");
  for (const arch of readdirSync(join(ptyRoot, "prebuilds"))) {
    if (arch !== os + "-x64") rmSync(join(ptyRoot, "prebuilds", arch), { recursive: true });
  }
  for (const name of ["connector", "shared", "server"])
    cpSync("dist/" + name, join(app, "dist", name), { recursive: true });
  // 同一份发行版本同时写入客户端包和服务端下载清单。
  writeFileSync(
    join(app, "dist/connector/release.json"),
    JSON.stringify(
      {
        version,
        revision,
        platform,
        arch: "x64",
        updateProtocol: 3,
        // 仅协议三目标读写兼容；明确不提供自动回滚。
        dataFormat: 2,
        compatibility: currentUpdateCompatibility,
      },
      null,
      2,
    ),
  );
  mkdirSync(join(app, "dist/web/assets"), { recursive: true });
  cpSync(
    "public/assets/bugpaw-app-icon-brown-paw.png",
    join(app, "dist/web/assets/bugpaw-app-icon-brown-paw.png"),
  );
  for (const name of ["LICENSE", "NOTICE"]) cpSync(name, join(root, name));
  // 随包保留第三方许可及 NOTICE 引用的相对路径。
  const noticesDir = join(root, "public/assets");
  mkdirSync(noticesDir, { recursive: true });
  for (const file of ["LICENSE-BugPaw.txt", "LICENSE-LobeHub.txt", "LICENSE-abstract-logging.txt"]) {
    cpSync(join("public/assets", file), join(noticesDir, file));
  }
  cpSync(
    "docs/connector-diagnostics.md",
    join(root, "CONNECTOR-DIAGNOSTICS.md"),
  );
  cpSync("docs/connector-updates.md", join(root, "CONNECTOR-UPDATES.md"));
  mkdirSync(join(root, "runtime"), { recursive: true });
  const unpack = join(cache, nodeName);
  if (!existsSync(unpack)) {
    if (platform === "windows")
      execFileSync("unzip", ["-q", runtimeArchive, "-d", cache]);
    else execFileSync("tar", ["-xJf", runtimeArchive, "-C", cache]);
  }
  cpSync(
    join(unpack, platform === "windows" ? "node.exe" : "bin/node"),
    join(root, "runtime", platform === "windows" ? "node.exe" : "node"),
  );
  cpSync(join(unpack, "LICENSE"), join(root, "runtime", "LICENSE"));
  const launcher = join(
    root,
    platform === "windows" ? "bugpaw-relay.exe" : "bugpaw-relay",
  );
  execFileSync(platform === "windows" ? "x86_64-w64-mingw32-gcc" : "gcc", [
    ...(platform === "windows" ? ["-municode"] : []),
    "-O2",
    "-static",
    "packaging/launcher.c",
    "-o",
    launcher,
  ]);
  if (platform === "windows") {
    // 登录专用 GUI 子系统入口不分配控制台，手动 CLI 继续使用控制台子系统。
    execFileSync("x86_64-w64-mingw32-gcc", [
      "-municode", "-mwindows", "-DBUGPAW_LOGIN", "-O2", "-static",
      "packaging/launcher.c", "-o", join(root, "bugpaw-relay-login.exe"),
    ]);
    cpSync("packaging/windows-autostart.ps1", join(root, "windows-autostart.ps1"));
  }
  chmodSync(launcher, 0o755);
  writeFileSync(
    join(root, "使用说明.txt"),
    "BugPaw Relay " +
      version +
      "\n解压整个目录后，Windows 双击 bugpaw-relay.exe；Linux 运行 ./bugpaw-relay。\n默认打开本机 Web 配置页，无桌面的 Linux 请使用命令行。\n--cli 前台运行；configure 配置；register 注册；start 后台启动；stop 停止；status 查看；codex-login 官方登录。\nweb --no-open 仅显示本机控制台链接。\n配置保存在用户目录 .bugpaw-relay，首次安装本引导版需停止旧连接器并完整解压，保留原用户数据。后续可从服务端环境页下发兼容更新；请保留原安装入口及 .relay-update 目录，不把数据或项目放入应用目录。\n无需安装 Node/npm。请自行安装所需的 Codex CLI。升级后，原先使用内置 Claude SDK 的用户需要联网安装一次。在本机控制台的 CLI 工具页保存 Claude 模式，查看安装计划后点击「安装 Claude 支持」。无桌面环境可运行 bugpaw-relay claude status 和 bugpaw-relay claude install。环境 Claude 模式复用官方 CLI，自定义端点模式另安装锁定版本的 SDK。包内第三方依赖的许可证保留于 runtime/LICENSE 与 app/node_modules 各依赖目录。\n" +
      packageMessages["connector.package.storageUpgrade"]["zh-CN"] +
      packageMessages["connector.package.storageUpgrade"].en,
  );
  // 英文安装说明与中文说明随同一发行包交付，迁移约束保持一致。
  writeFileSync(
    join(root, "INSTRUCTIONS.txt"),
    `BugPaw Relay ${version}\nExtract the entire archive. On Windows, double-click bugpaw-relay.exe; on Linux, run ./bugpaw-relay.\nThe default entry opens the local Web console. For headless Linux, use the CLI.\n--cli: run in foreground; configure: configure; register: register; start/stop/status: manage the worker; codex-login: official sign-in.\nweb --no-open: print the local console URL without opening a browser.\nlanguage auto|zh-CN|en: save your CLI language; --lang en: override it for one command.\nConfiguration and data remain in ~/.bugpaw-relay. Stop the old connector and extract the complete package for this upgrade. Preserve your user data, original installation entry and .relay-update directory. Do not store data or projects inside the application directory.\nNode/npm installation is not required. Install the Codex CLI locally if needed. If you used the bundled Claude SDK, this upgrade requires a one-time online installation. Save the Claude mode on the CLI tools tab of the local console, review the plan, and choose Install Claude support. On headless systems, run bugpaw-relay claude status and bugpaw-relay claude install. Environment mode uses the official CLI. Custom endpoint mode also installs the pinned SDK. Licenses for bundled dependencies are retained in runtime/LICENSE and app/node_modules.\n` +
      packageMessages["connector.package.storageUpgrade"].en,
  );
  // npm 的 .bin 链接转换为包内普通文件，更新解包器始终拒绝链接。
  function inspect(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const rel = relative(root, path);
      const modulePath = relative(join(app, "node_modules"), path)
        .split(sep)
        .join("/");
      if (
        /^(?:@openai\/codex(?:-|$)|@anthropic-ai\/(?:claude-code(?:-|$)|claude-agent-sdk(?:-|$)))/.test(
          modulePath,
        )
      )
        throw Error("Unexpected bundled CLI: " + rel);
      if (
        /^(?:\.env(?:\..*)?|AGENTS\.md|CLAUDE\.md|CONTEXT\.md|\.git|\.vibe|\.bugpaw-relay|vault\.key|config\.json|worker\.json|.*\.(?:db|sqlite|log|pem|key))$/i.test(
          entry.name,
        )
      )
        throw Error("发行包包含禁止的运行或协作文件: " + rel);
      if (entry.isSymbolicLink()) {
        const target = realpathSync(path),
          delta = relative(root, target);
        if (
          delta.startsWith("..") ||
          isAbsolute(delta) ||
          !statSync(target).isFile()
        )
          throw Error("发行包链接越界: " + rel);
        const bytes = readFileSync(target),
          mode = statSync(target).mode;
        unlinkSync(path);
        writeFileSync(path, bytes, { mode });
      } else if (entry.isDirectory()) inspect(path);
      else if (!entry.isFile()) throw Error("发行包包含特殊文件: " + rel);
      if (
        lstatSync(path).isFile() &&
        statSync(path).size < 8 * 1024 * 1024 &&
        !path.includes("node_modules")
      ) {
        const text = readFileSync(path).toString("utf8");
        if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(text))
          throw Error("发行包包含私钥: " + rel);
      }
    }
  }
  inspect(root);
  const file = folder + (platform === "windows" ? ".zip" : ".tar.gz"),
    archive = join(output, file);
  rmSync(archive, { force: true });
  if (platform === "windows")
    execFileSync("zip", ["-qr", archive, folder], { cwd: stage });
  else
    execFileSync("tar", ["--format=gnu", "-czf", archive, "-C", stage, folder]);
  const sha256 = hash(archive);
  writeFileSync(archive + ".sha256", sha256 + "  " + file + "\n");
  releases.push({
    platform,
    arch: "x64",
    file,
    sha256,
    size: statSync(archive).size,
  });
  console.log("已生成 " + file);
}
writeFileSync(
  join(output, "release.json"),
  JSON.stringify(
    {
      version,
      revision,
      updateProtocol: 3,
      // 与包内声明同源，禁止向旧协议伪装成格式一。
      dataFormat: 2,
      compatibility: currentUpdateCompatibility,
      claudeOnDemand: true,
      releases,
    },
    null,
    2,
  ),
);
