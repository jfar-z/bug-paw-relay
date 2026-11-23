import {
  parseLanguageArgs,
  readLocalePreference,
  saveLocalePreference,
  systemLocale,
} from "./locale.js";
import {
  translate,
  type Locale,
  type LocalePreference,
} from "../shared/i18n.js";
import { errorBody } from "../shared/i18n-errors.js";
import { message as i18nMessage } from "../shared/i18n.js";
import {
  applicationRoot,
  installRoot,
  assertNotUpdating,
} from "./update-installation.js";
import { superviseUpdate, recoverUpdateBeforeWorker } from "./updater.js";
import { homedir } from "node:os";
import { dirname, join, resolve, delimiter, isAbsolute } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { cliInvocation, hostCli } from "./host-cli.js";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline/promises";
import { AppError, ensure } from "../shared/contracts.js";
import { claudeSupportStatus, installClaudeSupport } from "./claude-support.js";
import { ConnectorConfig } from "./config.js";
import { workerStatus, startWorker, stopWorker } from "./process.js";
import { runWorker } from "./worker.js";
import { startWeb } from "./local-web.js";
/** 将随包运行时加入子进程搜索路径，无需系统安装 Node。 */
const pathKey =
  Object.keys(process.env).find((k) => k.toLowerCase() === "path") || "PATH";
process.env[pathKey] =
  dirname(process.execPath) + delimiter + (process.env[pathKey] || "");
let locale: Locale = systemLocale();
try {
  const parsed = parseLanguageArgs(process.argv.slice(2));
  const args = parsed.args;
  // 计划任务显式保留数据目录；语言命令不初始化包含凭据的配置。
  const dataHomeIndex = args.indexOf("--data-home");
  if (dataHomeIndex >= 0) {
    const dataHome = args[dataHomeIndex + 1];
    ensure(
      dataHome && isAbsolute(dataHome),
      "INVALID_PARAMS",
      i18nMessage("errors.INVALID_PARAMS.the.data.directory.must.be.an"),
    );
    process.env.BUGPAW_HOME = dataHome;
    args.splice(dataHomeIndex, 2);
  }
  // 人工完整重装可显式提供旧安装根，仅用于核验旧监督器和原日志，不改写旧文件。
  const previousRootIndex = args.indexOf("--previous-install-root");
  if (previousRootIndex >= 0) {
    const previousRoot = args[previousRootIndex + 1];
    ensure(
      previousRoot && isAbsolute(previousRoot),
      "INVALID_PARAMS",
      i18nMessage("connector.update.previousRootInvalid"),
    );
    process.env.BUGPAW_PREVIOUS_INSTALL_ROOT = previousRoot;
    args.splice(previousRootIndex, 2);
  }
  const dir = resolve(
    process.env.BUGPAW_HOME || join(homedir(), ".bugpaw-relay"),
  );
  const saved = readLocalePreference(dir);
  const selected = parsed.override ?? saved.preference;
  locale = selected === "auto" ? systemLocale() : selected;
  const t = (key: Parameters<typeof translate>[1], params = {}) =>
    translate(locale, key, params);
  if (saved.corrupt) console.error(t("cli.language.corrupt"));
  const cliMode = args[0] === "--cli";
  if (cliMode) args.shift();
  const command = args[0] || (cliMode ? "run" : "web");
  if (command === "language") {
    ensure(
      args.length <= 2 &&
        (args.length === 1 || ["auto", "zh-CN", "en"].includes(args[1])),
      "INVALID_PARAMS",
      i18nMessage("cli.language.invalid"),
    );
    if (args.length === 2) {
      const value = args[1] as LocalePreference;
      saveLocalePreference(dir, value);
      locale = value === "auto" ? systemLocale() : value;
      console.log(t("cli.language.saved", { preference: value, locale }));
    } else {
      console.log(
        t("cli.language.current", {
          preference: selected,
          locale,
          auto: t(selected === "auto" ? "cli.yes" : "cli.no"),
          source: t(
            parsed.override !== undefined
              ? "cli.source.override"
              : saved.source === "file"
                ? "cli.source.file"
                : "cli.source.system",
          ),
        }),
      );
    }
  } else {
    process.env.BUGPAW_INSTALL_ROOT = installRoot();
    const rawCommand = command;
    const recoveryCommand = rawCommand === "update-supervise";
    const selectedRoot = recoveryCommand ? installRoot() : applicationRoot();
    const selectedEntry = join(selectedRoot, "app/dist/connector/main.js");
    if (
      !recoveryCommand &&
      existsSync(selectedEntry) &&
      resolve(fileURLToPath(import.meta.url)) !== resolve(selectedEntry)
    ) {
      const result = spawnSync(
        join(
          selectedRoot,
          "runtime",
          process.platform === "win32" ? "node.exe" : "node",
        ),
        [selectedEntry, ...process.argv.slice(2)],
        { stdio: "inherit", env: process.env },
      );
      process.exit(result.status ?? 1);
    }
    const settings = new ConnectorConfig(dir);
    if (command === "claude") {
      ensure(args.length === 2 && ["install", "status"].includes(args[1]), "INVALID_PARAMS", i18nMessage("connector.support.usage"));
      const config = settings.read().claude;
      if (args[1] === "install") assertNotUpdating();
      const status = args[1] === "install"
        ? await installClaudeSupport(dir, config, key => console.error(t(key)))
        : await claudeSupportStatus(dir, config);
      console.log(JSON.stringify(status, null, 2));
      console.error(t(status.ready ? config.mode === "environment" ? "connector.support.login" : "connector.support.endpoint" : status.cli.explicitInvalid ? "connector.support.path" : "connector.support.required"));
      if (!status.ready) process.exitCode = 1;
    } else if (command === "update-supervise")
      await superviseUpdate(settings, args[1]);
    else if (["web", "--web", "console"].includes(command))
      await startWeb(settings, !args.includes("--no-open"), locale);
    else if (command === "run") {
      recoverUpdateBeforeWorker(settings.dir);
      await runWorker(settings);
    } else if (command === "start")
      console.log(JSON.stringify(await startWorker(settings, locale)));
    else if (command === "stop") {
      assertNotUpdating();
      console.log(JSON.stringify(await stopWorker(settings, locale)));
    } else if (command === "status")
      console.log(
        JSON.stringify({
          ...(await workerStatus(settings, locale)),
          registered: !!settings.read().environmentId,
          dataDirectory: dir,
        }),
      );
    else if (command === "configure" || command === "register") {
      ensure(
        !(await workerStatus(settings, locale)).running,
        "RUNNING",
        i18nMessage("errors.RUNNING.stop.the.connector.before.changing.its"),
      );
      const terminal = createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      try {
        if (command === "register") {
          await settings.register(
            (await terminal.question(t("cli.registration.code"))).trim(),
            locale,
          );
          console.log(t("cli.registration.success"));
        } else {
          const serverUrl = await terminal.question(t("cli.configure.url"));
          const name = await terminal.question(t("cli.configure.name"));
          const root = await terminal.question(t("cli.configure.root"));
          settings.update({
            ...settings.public(),
            serverUrl,
            name,
            roots: [{ id: "workspace", path: resolve(root) }],
          });
          console.log(t("cli.configure.saved"));
        }
      } finally {
        terminal.close();
      }
    } else if (command === "codex-login") {
      assertNotUpdating();
      const cli = cliInvocation(hostCli("codex", settings.read().codex));
      const result = spawnSync(
        cli.command,
        [...cli.prefix, "login"],
        { stdio: "inherit" },
      );
      ensure(
        result.status === 0,
        "LOGIN_FAILED",
        i18nMessage("errors.LOGIN_FAILED.codex.login.did.not.complete"),
      );
    } else if (command === "autostart") {
      assertNotUpdating();
      ensure(args.length === 2 && ["enable", "disable"].includes(args[1]),
        "INVALID_PARAMS", i18nMessage("cli.autostart.usage"));
      const enable = args[1] === "enable";
      const launcher = join(
        installRoot(),
        process.platform === "win32" ? "bugpaw-relay.exe" : "bugpaw-relay",
      );
      ensure(
        existsSync(launcher),
        "UNMANAGED_INSTALL",
        i18nMessage(
          "errors.UNMANAGED_INSTALL.configure.autostart.from.a.complete.installation",
        ),
      );
      if (process.platform === "linux") {
        const unitDir = join(homedir(), ".config/systemd/user");
        mkdirSync(unitDir, { recursive: true });
        const unit = join(unitDir, "bugpaw-relay.service");
        if (enable)
          writeFileSync(
            unit,
            `[Unit]\nDescription=BugPaw Relay connector\n[Service]\nExecStart="${launcher}" run\nEnvironment="BUGPAW_HOME=${dir}"\nRestart=on-failure\n[Install]\nWantedBy=default.target\n`,
          );
        spawnSync("systemctl", ["--user", "daemon-reload"], {
          stdio: "inherit",
        });
        const result = spawnSync(
          "systemctl",
          ["--user", enable ? "enable" : "disable", "bugpaw-relay.service"],
          { stdio: "inherit" },
        );
        ensure(
          result.status === 0,
          "SERVICE_FAILED",
          i18nMessage(
            "errors.SERVICE_FAILED.could.not.configure.autostart.check.the",
          ),
        );
      } else if (process.platform === "win32") {
        // 固定的命令正文与用户路径分开传递，兼容空格和 PowerShell 特殊字符。
        const script = join(selectedRoot, "windows-autostart.ps1");
        ensure(existsSync(script), "UNMANAGED_INSTALL", i18nMessage(
          "errors.UNMANAGED_INSTALL.configure.autostart.from.a.complete.installation",
        ));
        const result = spawnSync(
          join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
          ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", readFileSync(script, "utf8")],
          {
            windowsHide: true,
            stdio: "ignore",
            env: {
              ...process.env,
              BUGPAW_AUTOSTART_MODE: args[1],
              BUGPAW_AUTOSTART_APP: selectedRoot,
              BUGPAW_HOME: dir,
            },
          },
        );
        ensure(
          result.status === 0,
          "SERVICE_FAILED",
          i18nMessage(result.status === 2 ? "cli.autostart.legacyBlocked" : "cli.autostart.windowsFailed"),
        );
      } else
        throw new AppError(
          "UNSUPPORTED_PLATFORM",
          i18nMessage("cli.autostart.unsupported"),
        );
    } else console.log(t("cli.help"));
  }
} catch (error) {
  console.error(errorBody(error, locale).message);
  process.exitCode = 1;
}
