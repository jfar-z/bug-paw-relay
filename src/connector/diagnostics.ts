import { appendFile, rename, stat, rm } from "node:fs/promises";
import { join } from "node:path";
/** 独立诊断文件异步轮转；最多五份各 10 MiB，日志错误不得影响执行。 */
export class ConnectorDiagnostics {
  private queue: string[] = [];
  private writing = false;
  private dropped = 0;
  private lastStorageWarning = -Infinity;
  constructor(
    private dir: string,
    private context: Record<string, unknown>,
  ) {}
  write(event: string, fields: any = {}) {
    if (event === "storage.batch") {
      if (
        (fields.writeMs >= 500 || fields.oldestMs >= 1000) &&
        performance.now() - this.lastStorageWarning >= 60000
      ) {
        this.lastStorageWarning = performance.now();
        this.write("storage.slow", {
          executionId: fields.executionId,
          writeMs: fields.writeMs,
          oldestMs: fields.oldestMs,
          writeThresholdMs: 500,
          waitThresholdMs: 1000,
        });
      }
      return;
    }
    if (this.queue.length >= 256) {
      this.dropped++;
      return;
    }
    this.queue.push(
      JSON.stringify({
        time: new Date().toISOString(),
        event,
        ...this.context,
        ...fields,
        droppedLogs: this.dropped,
      }) + "\n",
    );
    this.dropped = 0;
    void this.drain();
  }
  private async drain() {
    if (this.writing) return;
    this.writing = true;
    try {
      const file = join(this.dir, "connection-diagnostics.log");
      while (this.queue.length) {
        const line = this.queue.shift()!;
        if (
          (await stat(file).catch(() => ({ size: 0 }))).size +
            Buffer.byteLength(line) >
          10 * 1024 * 1024
        ) {
          await rm(file + ".4", { force: true });
          for (let i = 3; i >= 0; i--)
            await rename(i ? file + "." + i : file, file + "." + (i + 1)).catch(
              () => {},
            );
        }
        await appendFile(file, line, { mode: 0o600 });
      }
    } catch {
      this.queue.length = 0;
    } finally {
      this.writing = false;
    }
  }
}
