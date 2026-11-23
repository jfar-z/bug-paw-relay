import { message as i18nMessage } from "../shared/i18n.js";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  existsSync,
  statfsSync,
  statSync,
  openSync,
  closeSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { z } from "zod";
import { ensure, AppError } from "../shared/contracts.js";
import {
  updateTargetSchema,
  updateReportSchema,
  updateTerminal,
  MAX_EXPANDED_BYTES,
  updateMessage,
  updateCompatibilitySchema,
  type UpdateReport,
} from "../shared/connector-update.js";
import {
  activeUpdate,
  installedUpdateFacts,
  assertUpdateCompatibility,
  applicationRoot,
  atomicJson,
  installRoot,
  installationStatus,
  journalPath,
  readUpdate,
  readRecoveryUpdate,
  saveUpdate,
  setApplication,
  updateDirectory,
  type LocalUpdate,
} from "./update-installation.js";
import { extractUpdate } from "./update-archive.js";
import { readConnectorVersion } from "./version.js";
import { stopWorker } from "./process.js";
import type { ConnectorConfig } from "./config.js";

export function publicUpdate(o: LocalUpdate): UpdateReport {
  return updateReportSchema.parse(
    Object.fromEntries(
      Object.keys(updateReportSchema.shape).map((k) => [k, (o as any)[k]]),
    ),
  );
}
function buildId() {
  try {
    return (
      JSON.parse(
        readFileSync(new URL("./release.json", import.meta.url), "utf8"),
      ).revision || null
    );
  } catch {
    return null;
  }
}
/** 下载及解包在旧 worker 存活期间执行，切换交给独立监督进程。 */
export class ConnectorUpdater {
  private running = new Set<string>();
  private abort?: AbortController;
  constructor(
    private settings: ConnectorConfig,
    private busy: () => Promise<boolean>,
    private notify: (report: UpdateReport) => void,
    private authorizeSwitch: (id: string) => Promise<unknown>,
  ) {}
  installation() {
    const status = installationStatus(
      this.settings.dir,
      this.settings.read().roots,
    );
    if (!status.managed) return status;
    try {
      const current = installedUpdateFacts(this.settings.dir);
      assertUpdateCompatibility(this.settings.dir, current);
      return { ...status, current };
    } catch (error) {
      return {
        ...status,
        blockedReason:
          error instanceof AppError ? error.code : "COMPATIBILITY_UNKNOWN",
      };
    }
  }
  private save(o: LocalUpdate, patch: Partial<LocalUpdate>) {
    const saved = saveUpdate(o, patch);
    this.notify(publicUpdate(saved));
    return saved;
  }
  async prepare(input: unknown) {
    const p = z
      .object({
        operationId: z.string().uuid(),
        expectedCurrentVersion: z.string(),
        target: updateTargetSchema,
      })
      .strict()
      .parse(input);
    let previous = readUpdate(p.operationId);
    let busy = false;
    if (!previous) {
      ensure(
        this.installation().managed,
        "UNMANAGED_INSTALL",
        i18nMessage(
          "errors.UNMANAGED_INSTALL.this.installation.does.not.support.safe",
        ),
        409,
      );
      busy = await this.busy();
      // 探测期间可能收到同一操作的重试，再读日志后同步完成资格检查与落盘。
      previous = readUpdate(p.operationId);
    }
    if (previous) {
      ensure(
        previous.expectedCurrentVersion === p.expectedCurrentVersion &&
          JSON.stringify(previous.target) === JSON.stringify(p.target),
        "IDEMPOTENCY_CONFLICT",
        i18nMessage("errors.IDEMPOTENCY_CONFLICT.update.parameters.conflict"),
        409,
      );
      return publicUpdate(previous);
    }
    ensure(
      !activeUpdate() && !busy,
      "ENVIRONMENT_BUSY",
      i18nMessage(
        "errors.ENVIRONMENT_BUSY.the.environment.is.executing.or.transferring",
      ),
      409,
    );
    ensure(
      readConnectorVersion() === p.expectedCurrentVersion &&
        p.target.version !== p.expectedCurrentVersion,
      "TARGET_CHANGED",
      i18nMessage("errors.TARGET_CHANGED.the.current.version.has.changed"),
      409,
    );
    ensure(
      p.target.platform ===
        (process.platform === "win32" ? "windows" : process.platform) &&
        process.arch === p.target.arch &&
        p.target.file ===
          `bugpaw-relay-${p.target.version}-${p.target.platform}-x64.${p.target.platform === "windows" ? "zip" : "tar.gz"}`,
      "INCOMPATIBLE_PACKAGE",
      i18nMessage(
        "errors.INCOMPATIBLE_PACKAGE.the.release.package.is.incompatible",
      ),
      409,
    );
    ensure(
      /^[a-f0-9]{40}$/.test(buildId() || ""),
      "COMPATIBILITY_UNKNOWN",
      updateMessage("COMPATIBILITY_UNKNOWN"),
    );
    assertUpdateCompatibility(this.settings.dir, p.target);
    const space = statfsSync(installRoot());
    ensure(
      space.bavail * space.bsize >= MAX_EXPANDED_BYTES + p.target.size,
      "INSUFFICIENT_SPACE",
      i18nMessage("errors.INSUFFICIENT_SPACE.insufficient.installation.space"),
      409,
    );
    const o: LocalUpdate = {
      ...p,
      previous: applicationRoot(),
      previousBuildId: buildId(),
      state: "prechecking",
      lastConfirmedState: "prechecking",
      stateVersion: 0,
      downloadedBytes: 0,
      actualVersion: readConnectorVersion(),
      actualBuildId: buildId(),
      errorCode: null,
    };
    try {
      atomicJson(journalPath(p.operationId), o);
    } catch {
      throw new AppError(
        "INSTALL_PERMISSION_DENIED",
        i18nMessage(
          "errors.INSTALL_PERMISSION_DENIED.the.installation.directory.is.not.writable",
        ),
        409,
      );
    }
    return publicUpdate(o);
  }
  status(id: string) {
    let o = readUpdate(id);
    if (!o && process.env.BUGPAW_PREVIOUS_INSTALL_ROOT)
      o = readRecoveryUpdate(
        id,
        this.settings.dir,
        process.env.BUGPAW_PREVIOUS_INSTALL_ROOT,
      );
    // 仅已初始化的新目标进程报告就绪；服务端仍负责原身份认证及执行对账。
    if (
      o?.target.updateProtocol === 3 &&
      ["restarting", "reconciling", "recovery_required"].includes(o.state) &&
      readConnectorVersion() === o.target.version &&
      buildId() === o.target.buildId &&
      !supervisorAlive() &&
      !switchRecord(this.settings.dir)
    ) {
      assertUpdateCompatibility(this.settings.dir, o.target);
      if (o.state !== "reconciling")
        o = this.save(o, {
          state: "reconciling",
          actualVersion: readConnectorVersion(),
          actualBuildId: buildId(),
          errorCode: null,
        });
    }
    if (
      o &&
      !updateTerminal(o.state) &&
      !supervisorAlive() &&
      !switchRecord(this.settings.dir) &&
      readConnectorVersion() !== o.expectedCurrentVersion &&
      readConnectorVersion() !== o.target.version
    ) {
      o = this.save(o, {
        state: "recovery_required",
        actualVersion: readConnectorVersion(),
        actualBuildId: buildId(),
        errorCode: "RECOVERY_REQUIRED",
      });
    }
    return o ? publicUpdate(o) : { state: "not_found" };
  }
  /** 人工完整安装后的受认证恢复，不重放任何切换或业务请求。 */
  recover(input: unknown) {
    const p = z
      .object({
        operationId: z.string().uuid(),
        target: updateTargetSchema,
        expectedCurrentVersion: z.string(),
      })
      .strict()
      .parse(input);
    ensure(
      !supervisorAlive() && !switchRecord(this.settings.dir),
      "RECOVERY_REQUIRED",
      updateMessage("RECOVERY_REQUIRED"),
    );
    const current = installedUpdateFacts(this.settings.dir);
    ensure(
      current.updateProtocol === 3,
      "BOOTSTRAP_REQUIRED",
      updateMessage("BOOTSTRAP_REQUIRED"),
    );
    assertUpdateCompatibility(this.settings.dir, current);
    const existing = readUpdate(p.operationId);
    if (existing?.recoverySourceRoot)
      ensure(
        readRecoveryUpdate(
          p.operationId,
          this.settings.dir,
          existing.recoverySourceRoot,
        ),
        "RECOVERY_REQUIRED",
        updateMessage("RECOVERY_REQUIRED"),
      );
    ensure(
      !existing || JSON.stringify(existing.target) === JSON.stringify(p.target),
      "TARGET_CHANGED",
      updateMessage("TARGET_CHANGED"),
    );
    const active = activeUpdate();
    ensure(
      !active || active.operationId === p.operationId,
      "UPDATE_IN_PROGRESS",
      updateMessage("UPDATE_IN_PROGRESS"),
    );
    const o: LocalUpdate = existing || {
      ...p,
      previous: applicationRoot(),
      state: "recovery_required",
      lastConfirmedState: "recovery_required",
      stateVersion: 0,
      downloadedBytes: 0,
      actualVersion: null,
      actualBuildId: null,
      errorCode: null,
    };
    return publicUpdate(
      this.save(o, {
        state: "recovered",
        actualVersion: readConnectorVersion(),
        actualBuildId: buildId(),
        errorCode: null,
      }),
    );
  }
  confirm(id: string, sha256: string) {
    const o = readUpdate(id);
    ensure(
      o &&
        ["reconciling", "succeeded"].includes(o.state) &&
        o.target.sha256 === sha256 &&
        readConnectorVersion() === o.target.version &&
        buildId() === o.target.buildId,
      "RECOVERY_REQUIRED",
      i18nMessage("errors.RECOVERY_REQUIRED.the.update.has.not.passed.local"),
      409,
    );
    if (o.state !== "succeeded") this.save(o, { state: "succeeded" });
    void cleanUnusedPackages().catch(() => {});
    return { ok: true };
  }
  revoke() {
    this.abort?.abort();
  }
  start(id: string, authorization: unknown) {
    const o = readUpdate(id);
    ensure(
      o,
      "NOT_FOUND",
      i18nMessage("errors.NOT_FOUND.update.record.not.found"),
      404,
    );
    if (this.running.has(id) || !["accepted", "prechecking"].includes(o.state))
      return publicUpdate(o);
    const grant = z
      .object({ grant: z.string().max(8192), expiresAt: z.number() })
      .strict()
      .parse(authorization);
    this.running.add(id);
    // 磁盘完全不可写时保留非终态日志与维护锁，不能因写失败放行任务。
    void this.download(o, grant.grant)
      .finally(() => this.running.delete(id))
      .catch(() => {});
    return publicUpdate(o);
  }
  private async download(initial: LocalUpdate, grant: string) {
    let o = initial;
    this.abort = new AbortController();
    const idle = new AbortController();
    let idleTimer = setTimeout(() => idle.abort(), 120000);
    const progress = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => idle.abort(), 120000);
    };
    try {
      const origin = new URL(this.settings.read().serverUrl);
      ensure(
        origin.protocol === "https:" ||
          (origin.protocol === "http:" &&
            ["localhost", "127.0.0.1", "[::1]"].includes(origin.hostname)),
        "DOWNLOAD_UNAUTHORIZED",
        i18nMessage(
          "errors.DOWNLOAD_UNAUTHORIZED.updates.require.a.trusted.https.server",
        ),
      );
      const url = new URL(
        `/api/node/connector-updates/${o.operationId}/package`,
        origin,
      );
      o = this.save(o, { state: "downloading" });
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${grant}` },
        redirect: "error",
        signal: AbortSignal.any([this.abort.signal, idle.signal]),
      });
      ensure(
        response.ok && response.body,
        "DOWNLOAD_FAILED",
        i18nMessage(
          "errors.DOWNLOAD_FAILED.could.not.download.the.update.package",
        ),
      );
      if (response.headers.has("content-length"))
        ensure(
          Number(response.headers.get("content-length")) === o.target.size,
          "CHECKSUM_MISMATCH",
          i18nMessage("errors.CHECKSUM_MISMATCH.package.size.mismatch"),
        );
      const chunks: Buffer[] = [],
        hash = createHash("sha256");
      let size = 0,
        last = 0;
      for await (const bytes of response.body) {
        progress();
        const chunk = Buffer.from(bytes);
        size += chunk.length;
        ensure(
          size <= o.target.size,
          "CHECKSUM_MISMATCH",
          i18nMessage(
            "errors.CHECKSUM_MISMATCH.the.download.exceeds.the.declared.size",
          ),
        );
        hash.update(chunk);
        chunks.push(chunk);
        if (Date.now() - last > 500) {
          o = this.save(o, { downloadedBytes: size });
          last = Date.now();
        }
      }
      clearTimeout(idleTimer);
      o = this.save(o, { state: "verifying", downloadedBytes: size });
      ensure(
        size === o.target.size && hash.digest("hex") === o.target.sha256,
        "CHECKSUM_MISMATCH",
        i18nMessage(
          "errors.CHECKSUM_MISMATCH.update.package.checksum.mismatch",
        ),
      );
      ensure(
        !this.abort.signal.aborted,
        "REVOKED",
        i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"),
      );
      o = this.save(o, { state: "installing" });
      const versions = join(updateDirectory(), "versions");
      mkdirSync(versions, { recursive: true, mode: 0o700 });
      const candidate = extractUpdate(
        Buffer.concat(chunks),
        join(versions, o.operationId),
        `bugpaw-relay-${o.target.version}-${o.target.platform}-x64`,
        o.target.platform,
      );
      const metadata = JSON.parse(
        readFileSync(
          join(candidate, "app/dist/connector/release.json"),
          "utf8",
        ),
      );
      const declared = updateCompatibilitySchema.safeParse(
        metadata.compatibility,
      );
      const frozen = updateCompatibilitySchema.safeParse(
        o.target.compatibility,
      );
      ensure(
        declared.success && frozen.success,
        "COMPATIBILITY_UNKNOWN",
        updateMessage("COMPATIBILITY_UNKNOWN"),
      );
      ensure(
        metadata.updateProtocol === o.target.updateProtocol &&
          metadata.dataFormat === o.target.dataFormat &&
          JSON.stringify(declared.data) === JSON.stringify(frozen.data),
        "COMPATIBILITY_CONFLICT",
        updateMessage("COMPATIBILITY_CONFLICT"),
      );
      ensure(
        metadata.version === o.target.version &&
          metadata.revision === o.target.buildId &&
          metadata.platform === o.target.platform &&
          metadata.arch === o.target.arch,
        "INCOMPATIBLE_PACKAGE",
        updateMessage("INCOMPATIBLE_PACKAGE"),
      );
      for (const file of [
        "app/dist/connector/main.js",
        "app/dist/connector/worker.js",
        "app/dist/connector/updater.js",
        "app/package.json",
        "runtime/" + (process.platform === "win32" ? "node.exe" : "node"),
      ])
        ensure(
          statSync(join(candidate, file)).isFile(),
          "INCOMPATIBLE_PACKAGE",
          i18nMessage(
            "errors.INCOMPATIBLE_PACKAGE.the.package.is.missing.required.files",
          ),
        );
      ensure(
        !this.abort.signal.aborted,
        "REVOKED",
        i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"),
      );
      // 切换前通过认证通道再次确认身份与操作仍有效；网络故障保留原版。
      await this.authorizeSwitch(o.operationId);
      const busy = await this.busy();
      ensure(
        !this.abort.signal.aborted,
        "REVOKED",
        i18nMessage("errors.REVOKED.the.environment.identity.has.been.revoked"),
      );
      assertUpdateCompatibility(this.settings.dir, o.target);
      ensure(
        !busy,
        "ENVIRONMENT_BUSY",
        updateMessage("ENVIRONMENT_BUSY"),
      );
      o = this.save(o, { state: "restarting", candidate });
      const child = spawn(
        process.execPath,
        [
          join(applicationRoot(), "app/dist/connector/main.js"),
          "update-supervise",
          o.operationId,
        ],
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
          env: {
            ...process.env,
            BUGPAW_HOME: this.settings.dir,
            BUGPAW_INSTALL_ROOT: installRoot(),
          },
        },
      );
      child.on("error", () => {
        this.save(readUpdate(o.operationId)!, {
          state: "failed",
          errorCode: "RESTART_FAILED",
        });
      });
      child.unref();
    } catch (error) {
      const code =
        error instanceof AppError
          ? error.code
          : (error as NodeJS.ErrnoException).code === "ENOSPC"
            ? "INSUFFICIENT_SPACE"
            : ["EACCES", "EPERM"].includes(
                  (error as NodeJS.ErrnoException).code || "",
                )
              ? "INSTALL_PERMISSION_DENIED"
              : "DOWNLOAD_FAILED";
      this.save(o, { state: "failed", errorCode: code });
    } finally {
      clearTimeout(idleTimer);
      this.abort = undefined;
    }
  }
}

/** PID 只用于保守判断，未知或复用的 PID 阻止切换，不终止进程。 */
function processPresent(pid: number) {
  ensure(
    Number.isSafeInteger(pid) && pid > 0,
    "RECOVERY_REQUIRED",
    updateMessage("RECOVERY_REQUIRED"),
  );
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
/** 数据目录级锁以 SQLite 事务竞争，避免不同安装根清理过期锁时互相覆盖。 */
function switchRecord(
  dataDirectory: string,
): { pid: number; operationId: string } | null {
  const path = join(dataDirectory, "environment.db");
  if (!existsSync(path)) return null;
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    if (
      !db
        .prepare("SELECT name FROM sqlite_master WHERE name='connector_switch'")
        .get()
    )
      return null;
    const record = db
      .prepare(
        "SELECT pid,operation_id AS operationId FROM connector_switch WHERE singleton=1",
      )
      .get() as { pid: number; operationId: string } | undefined;
    return record && processPresent(record.pid) ? record : null;
  } finally {
    db.close();
  }
}
/** 只保存临时切换归属，不复制用户数据或建立业务任务账本。 */
function claimSwitch(dataDirectory: string, operationId: string) {
  const db = new DatabaseSync(join(dataDirectory, "environment.db"));
  try {
    db.exec(
      "PRAGMA busy_timeout=1000; BEGIN IMMEDIATE; CREATE TABLE IF NOT EXISTS connector_switch(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,operation_id TEXT NOT NULL)",
    );
    const existing = db
      .prepare("SELECT pid FROM connector_switch WHERE singleton=1")
      .get();
    ensure(
      !existing || !processPresent(Number(existing.pid)),
      "UPDATE_IN_PROGRESS",
      updateMessage("UPDATE_IN_PROGRESS"),
    );
    db.prepare(
      "INSERT INTO connector_switch VALUES(1,?,?) ON CONFLICT(singleton) DO UPDATE SET pid=excluded.pid,operation_id=excluded.operation_id",
    ).run(process.pid, operationId);
    db.exec("COMMIT");
  } finally {
    db.close();
  }
}
function releaseSwitch(dataDirectory: string, operationId: string) {
  const db = new DatabaseSync(join(dataDirectory, "environment.db"));
  try {
    db.exec("PRAGMA busy_timeout=1000");
    db.prepare(
      "DELETE FROM connector_switch WHERE singleton=1 AND pid=? AND operation_id=?",
    ).run(process.pid, operationId);
  } finally {
    db.close();
  }
}

/** 监督进程独立于 worker；日志先落盘再切换，不触碰 BUGPAW_HOME 数据。 */
export async function superviseUpdate(settings: ConnectorConfig, id: string) {
  let o = readUpdate(id);
  ensure(o, "NOT_FOUND", i18nMessage("errors.NOT_FOUND.update.log.not.found"));
  assertUpdateCompatibility(settings.dir, o.target, o.previous);
  ensure(
    !supervisorAlive(),
    "UPDATE_IN_PROGRESS",
    updateMessage("UPDATE_IN_PROGRESS"),
  );
  claimSwitch(settings.dir, id);
  const launch = async (root: string) => {
    const log = openSync(join(settings.dir, "connector.log"), "a", 0o600);
    const child = spawn(
      join(root, "runtime", process.platform === "win32" ? "node.exe" : "node"),
      [join(root, "app/dist/connector/main.js"), "run"],
      {
        detached: true,
        stdio: ["ignore", log, log],
        windowsHide: true,
        env: {
          ...process.env,
          BUGPAW_HOME: settings.dir,
          BUGPAW_INSTALL_ROOT: installRoot(),
          BUGPAW_UPDATE_WORKER: id,
        },
      },
    );
    closeSync(log);
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", reject);
    });
    child.unref();
  };
  try {
    o = readUpdate(id)!;
    if (o.switchStage) return;
    o = saveUpdate(o, { supervisorPid: process.pid });
    if (o.state !== "restarting") return;
    ensure(
      o.candidate,
      "RECOVERY_REQUIRED",
      i18nMessage(
        "errors.RECOVERY_REQUIRED.the.candidate.directory.is.missing",
      ),
    );
    const candidate = o.candidate;
    assertUpdateCompatibility(settings.dir, o.target, o.previous);
    o = saveUpdate(o, { switchStage: "stopping" });
    const stopped = await stopWorker(settings);
    ensure(
      !stopped.running,
      "RESTART_FAILED",
      i18nMessage("errors.RESTART_FAILED.the.old.process.did.not.stop"),
    );
    setApplication(candidate);
    o = saveUpdate(o, { switchStage: "switched" });
    await launch(candidate);
    // 只记录启动动作，退出后由认证连接确认实际构建，不自动回滚或重启。
    saveUpdate(readUpdate(id)!, { switchStage: "launched" });
  } catch (error) {
    saveUpdate(readUpdate(id)!, {
      state: "recovery_required",
      errorCode: error instanceof AppError ? error.code : "RECOVERY_REQUIRED",
    });
  } finally {
    releaseSwitch(settings.dir, id);
  }
}

/** 新版认证后分批删除无引用旧包；永久入口和当前/在途目录始终保留。 */
async function cleanUnusedPackages() {
  const versions = join(updateDirectory(), "versions");
  if (!existsSync(versions)) return;
  let removed = 0;
  for (const id of readdirSync(versions)) {
    if (!/^[a-f0-9-]{36}$/i.test(id)) continue;
    const operation = readUpdate(id);
    if (!operation || !updateTerminal(operation.state)) continue;
    const directory = join(versions, id);
    if (
      applicationRoot().startsWith(directory + "/") ||
      applicationRoot().startsWith(directory + "\\")
    )
      continue;
    const active = activeUpdate();
    if (
      active &&
      [active.candidate, active.previous].some((path) =>
        path?.startsWith(directory),
      )
    )
      continue;
    await rm(directory, { recursive: true, force: true });
    if (++removed === 2) break;
  }
}

/** PID 仅用于保守拒绝并行切换，绝不据此杀进程。 */
function supervisorAlive() {
  const lock = join(updateDirectory(), "supervisor.lock");
  if (!existsSync(lock)) return false;
  try {
    const pid = Number(readFileSync(lock, "utf8"));
    if (!Number.isSafeInteger(pid) || pid <= 0) return true;
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

/** 断电后不猜测完成；下载阶段安全失败，切换后由人工完整安装恢复。 */
export function recoverUpdateBeforeWorker(dataDirectory?: string) {
  if (dataDirectory) {
    if (process.env.BUGPAW_PREVIOUS_INSTALL_ROOT) {
      const previous = activeUpdate(process.env.BUGPAW_PREVIOUS_INSTALL_ROOT);
      if (previous)
        readRecoveryUpdate(
          previous.operationId,
          dataDirectory,
          process.env.BUGPAW_PREVIOUS_INSTALL_ROOT,
        );
    }
    const switching = switchRecord(dataDirectory);
    ensure(
      !switching || switching.operationId === process.env.BUGPAW_UPDATE_WORKER,
      "UPDATE_IN_PROGRESS",
      updateMessage("UPDATE_IN_PROGRESS"),
    );
  }
  const o = activeUpdate();
  if (!o || process.env.BUGPAW_UPDATE_WORKER === o.operationId) return null;
  ensure(
    !supervisorAlive(),
    "UPDATE_IN_PROGRESS",
    updateMessage("UPDATE_IN_PROGRESS"),
  );
  if (
    [
      "accepted",
      "prechecking",
      "downloading",
      "verifying",
      "installing",
    ].includes(o.state)
  )
    saveUpdate(o, { state: "failed", errorCode: "DOWNLOAD_FAILED" });
  // 人工启动只走正常入口，绝不重放切换动作。
  return null;
}
