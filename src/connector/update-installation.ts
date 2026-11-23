import { DatabaseSync } from "node:sqlite";
import { message as i18nMessage } from "../shared/i18n.js";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
  statSync,
  readdirSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ensure, AppError } from "../shared/contracts.js";
import {
  updateTerminal,
  updateReportSchema,
  updateCompatibilityReason,
  updateMessage,
  type UpdateTarget,
  type UpdateReport,
} from "../shared/connector-update.js";

export type LocalUpdate = UpdateReport & {
  expectedCurrentVersion: string;
  previous: string;
  candidate?: string;
  supervisorPid?: number;
  /** 一次性切换进度；中断后仅人工启动，不重放停旧换包。 */
  switchStage?: "stopping" | "switched" | "launched";
  previousBuildId?: string;
  /** 人工跨安装目录恢复时，仅在本机保存旧安装核验来源。 */
  recoverySourceRoot?: string;
};
/** 引导目录永久保留；版本目录仅新增，不删除旧应用或用户数据。 */
export function installRoot() {
  if (process.env.BUGPAW_INSTALL_ROOT) return process.env.BUGPAW_INSTALL_ROOT;
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  // 源码/普通 dist 运行没有发行元数据，不能误把文件系统根识别为安装根。
  return resolve(
    moduleDirectory,
    existsSync(join(moduleDirectory, "release.json")) ? "../../.." : "../..",
  );
}
export function inside(parent: string, child: string) {
  const r = relative(parent, child);
  return r === "" || (!r.startsWith("..") && !isAbsolute(r));
}
function atomicText(file: string, text: string) {
  const temporary = file + ".new";
  const fd = openSync(temporary, "w", 0o600);
  try {
    writeFileSync(fd, text);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(temporary, file);
  // Windows 不支持目录 fsync，文件 fsync 和原子 rename 仍保留。
  if (process.platform !== "win32") {
    const dir = openSync(dirname(file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}
export function atomicJson(file: string, value: unknown) {
  atomicText(file, JSON.stringify(value));
}
export function updateDirectory(root = installRoot()) {
  return join(root, ".relay-update");
}
export function journalPath(operationId: string, root = installRoot()) {
  ensure(
    /^[a-f0-9-]{36}$/i.test(operationId),
    "INVALID_PARAMS",
    i18nMessage("errors.INVALID_PARAMS.invalid.update.operation.id"),
  );
  return join(updateDirectory(root), operationId + ".json");
}
export function readUpdate(
  id: string,
  root = installRoot(),
): LocalUpdate | null {
  const path = journalPath(id, root);
  return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : null;
}
/** 旧协议没有数据目录锁；必须核验用户明确提供的旧安装，而非猜测监督器已退出。 */
export function readRecoveryUpdate(
  id: string,
  dataDirectory: string,
  root: string,
): LocalUpdate | null {
  const source = realpathSync(root);
  const binding = JSON.parse(
    readFileSync(join(updateDirectory(source), "installation.json"), "utf8"),
  );
  ensure(
    binding.dataDirectory === realpathSync(dataDirectory),
    "UNMANAGED_INSTALL",
    updateMessage("UNMANAGED_INSTALL"),
  );
  const operation = readUpdate(id, source);
  if (!operation) return null;
  updateReportSchema.parse(
    Object.fromEntries(
      Object.keys(updateReportSchema.shape).map((key) => [
        key,
        (operation as any)[key],
      ]),
    ),
  );
  ensure(
    operation.operationId === id &&
      typeof operation.expectedCurrentVersion === "string" &&
      typeof operation.previous === "string" &&
      [1, 2, 3].includes(Number(operation.target.updateProtocol)),
    "RECOVERY_REQUIRED",
    updateMessage("RECOVERY_REQUIRED"),
  );
  const stopped = (pid: number) => {
    ensure(
      Number.isSafeInteger(pid) && pid > 0,
      "RECOVERY_REQUIRED",
      updateMessage("RECOVERY_REQUIRED"),
    );
    try {
      process.kill(pid, 0);
      return false;
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ESRCH";
    }
  };
  const lock = join(updateDirectory(source), "supervisor.lock");
  ensure(
    !existsSync(lock) || stopped(Number(readFileSync(lock, "utf8"))),
    "UPDATE_IN_PROGRESS",
    updateMessage("UPDATE_IN_PROGRESS"),
  );
  ensure(
    !operation.supervisorPid || stopped(operation.supervisorPid),
    "UPDATE_IN_PROGRESS",
    updateMessage("UPDATE_IN_PROGRESS"),
  );
  // 未留下监督器身份的在途切换可能尚未启动，不能以缺少锁文件证明结束。
  ensure(
    operation.supervisorPid ||
      !["restarting", "rolling_back"].includes(operation.state),
    "RECOVERY_REQUIRED",
    updateMessage("RECOVERY_REQUIRED"),
  );
  return { ...operation, recoverySourceRoot: source };
}

export function activeUpdate(root = installRoot()): LocalUpdate | null {
  const directory = updateDirectory(root);
  if (!existsSync(directory)) return null;
  for (const name of readdirSync(directory).filter((n) =>
    /^[a-f0-9-]{36}\.json$/i.test(n),
  )) {
    const o: LocalUpdate = JSON.parse(
      readFileSync(join(directory, name), "utf8"),
    );
    if (!updateTerminal(o.state)) return o;
  }
  return null;
}
export function saveUpdate(
  o: LocalUpdate,
  patch: Partial<LocalUpdate> = {},
  root = installRoot(),
) {
  const updated = { ...o, ...patch, stateVersion: o.stateVersion + 1 };
  if (patch.state && patch.state !== "recovery_required")
    updated.lastConfirmedState = patch.state;
  atomicJson(journalPath(o.operationId, root), updated);
  return updated;
}
export function applicationRoot(root = installRoot()) {
  const path = join(updateDirectory(root), "current.txt");
  if (!existsSync(path)) return root;
  ensure(
    realpathSync(updateDirectory(root)) ===
      join(realpathSync(root), ".relay-update"),
    "RECOVERY_REQUIRED",
    i18nMessage(
      "errors.RECOVERY_REQUIRED.update.directories.must.not.be.symbolic",
    ),
  );
  const pointer = { path: readFileSync(path, "utf8").trim() };
  ensure(
    typeof pointer.path === "string" &&
      (pointer.path === "." ||
        /^\.relay-update\/versions\/[a-f0-9-]{36}\/bugpaw-relay-[A-Za-z0-9.+-]+-(linux|windows)-x64$/.test(
          pointer.path,
        )),
    "RECOVERY_REQUIRED",
    i18nMessage(
      "errors.RECOVERY_REQUIRED.invalid.installation.pointer.check.the.local",
    ),
  );
  const result = realpathSync(resolve(root, pointer.path));
  ensure(
    inside(realpathSync(root), result),
    "RECOVERY_REQUIRED",
    i18nMessage(
      "errors.RECOVERY_REQUIRED.the.installation.pointer.is.outside.the",
    ),
  );
  return result;
}
export function setApplication(path: string, root = installRoot()) {
  ensure(
    inside(realpathSync(root), realpathSync(path)),
    "RECOVERY_REQUIRED",
    i18nMessage(
      "errors.RECOVERY_REQUIRED.the.installation.directory.is.outside.the",
    ),
  );
  atomicText(
    join(updateDirectory(root), "current.txt"),
    (relative(root, path).split("\\").join("/") || ".") + "\n",
  );
}
/** 一个受管安装只绑定一个数据目录，避免不同环境共享启动指针而互相换版本。 */
export function claimInstallation(dataDirectory: string, root = installRoot()) {
  if (!existsSync(join(root, "app/dist/connector/release.json"))) return;
  const physical = realpathSync(root),
    directory = updateDirectory(physical);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  ensure(
    realpathSync(directory) === directory,
    "UNMANAGED_INSTALL",
    i18nMessage(
      "errors.RECOVERY_REQUIRED.update.directories.must.not.be.symbolic",
    ),
  );
  const owner = join(directory, "installation.json"),
    home = realpathSync(dataDirectory);
  if (!existsSync(owner)) {
    try {
      const fd = openSync(owner, "wx", 0o600);
      try {
        writeFileSync(fd, JSON.stringify({ dataDirectory: home }));
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  let binding: any;
  try {
    binding = JSON.parse(readFileSync(owner, "utf8"));
  } catch {
    binding = null;
  }
  ensure(
    binding?.dataDirectory === home,
    "UNMANAGED_INSTALL",
    i18nMessage(
      "errors.UNMANAGED_INSTALL.this.installation.is.bound.to.another",
    ),
    409,
  );
}
/** 不移动秘密；自定义数据与工作根位于应用树内时直接拒绝。 */
export function installationStatus(
  dataDirectory: string,
  roots: { path: string }[],
  root = installRoot(),
) {
  try {
    const physical = realpathSync(root);
    ensure(
      statSync(
        join(
          physical,
          "runtime",
          process.platform === "win32" ? "node.exe" : "node",
        ),
      ).isFile(),
      "UNMANAGED_INSTALL",
      i18nMessage("errors.UNMANAGED_INSTALL.the.complete.runtime.is.missing"),
    );
    const metadata = JSON.parse(
      readFileSync(join(physical, "app/dist/connector/release.json"), "utf8"),
    );
    ensure(
      Number.isInteger(metadata.updateProtocol),
      "UNMANAGED_INSTALL",
      i18nMessage("errors.UNMANAGED_INSTALL.a.bootstrap.version.is.required"),
    );
    ensure(
      !inside(physical, realpathSync(dataDirectory)),
      "UNMANAGED_INSTALL",
      i18nMessage("errors.UNMANAGED_INSTALL.user.data.must.not.be.inside"),
    );
    for (const r of roots)
      ensure(
        !inside(physical, realpathSync(r.path)),
        "UNMANAGED_INSTALL",
        i18nMessage(
          "errors.UNMANAGED_INSTALL.the.working.directory.must.not.be",
        ),
      );
    const directory = updateDirectory(physical);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    ensure(
      realpathSync(directory) === directory,
      "UNMANAGED_INSTALL",
      i18nMessage(
        "errors.RECOVERY_REQUIRED.update.directories.must.not.be.symbolic",
      ),
    );
    claimInstallation(dataDirectory, root);
    return { managed: true, blockedReason: null };
  } catch {
    return { managed: false, blockedReason: "UNMANAGED_INSTALL" };
  }
}
/** 配置写入和本机启动同样遵守维护锁，旧控制台不能绕过更新。 */
export function assertNotUpdating() {
  ensure(
    !activeUpdate(),
    "UPDATE_IN_PROGRESS",
    i18nMessage(
      "errors.UPDATE_IN_PROGRESS.the.connector.is.updating.finish.verification",
    ),
    409,
  );
}

/** 只读实际账本格式；未知或损坏数据不允许通过候选启动试探。 */
export function installedUpdateFacts(
  dataDirectory: string,
  app = applicationRoot(),
) {
  try {
    const metadata = JSON.parse(
      readFileSync(join(app, "app/dist/connector/release.json"), "utf8"),
    );
    const db = new DatabaseSync(join(dataDirectory, "environment.db"), {
      readOnly: true,
    });
    try {
      const actual = Number(
        db.prepare("PRAGMA user_version").get()!.user_version,
      );
      ensure(
        actual === metadata.dataFormat,
        "ACTUAL_FORMAT_MISMATCH",
        updateMessage("ACTUAL_FORMAT_MISMATCH"),
      );
      return {
        updateProtocol: metadata.updateProtocol,
        dataFormat: actual,
        compatibility: metadata.compatibility,
      };
    } finally {
      db.close();
    }
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "COMPATIBILITY_UNKNOWN",
      updateMessage("COMPATIBILITY_UNKNOWN"),
    );
  }
}
/** 当前程序、永久引导器与目标必须共享恢复和持久化语义。 */
export function assertUpdateCompatibility(
  dataDirectory: string,
  target: Pick<
    UpdateTarget,
    "updateProtocol" | "dataFormat" | "compatibility" | "rollbackCompatible"
  >,
  app = applicationRoot(),
) {
  const current = installedUpdateFacts(dataDirectory, app);
  const reason = updateCompatibilityReason(current, target);
  ensure(
    !reason,
    reason || "COMPATIBILITY_UNKNOWN",
    updateMessage(reason || "COMPATIBILITY_UNKNOWN"),
  );
  const bootstrap = JSON.parse(
    readFileSync(
      join(installRoot(), "app/dist/connector/release.json"),
      "utf8",
    ),
  );
  const bootstrapReason = updateCompatibilityReason(bootstrap, target);
  ensure(
    !bootstrapReason,
    "BOOTSTRAP_REQUIRED",
    updateMessage("BOOTSTRAP_REQUIRED"),
  );
}
