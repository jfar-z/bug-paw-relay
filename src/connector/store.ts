import { isCodexAsyncQuestion } from "../shared/user-questions.js";
import { randomUUID } from "node:crypto";
import { Store } from "../server/store.js";
import type { Entity } from "../shared/contracts.js";

/** 环境专用 v2 账本：事件增量入库，状态与事件共用事务，与服务端阶段编号迁移独立。 */
export class ConnectorStore extends Store {
  private transactionDepth = 0;

  constructor(path: string) {
    // 环境格式版本独立管理，禁止执行服务端看板迁移。
    super(path, false, 2);
    try {
      this.db.exec("PRAGMA busy_timeout=50");
      this.transaction(() => {
        this.db.exec(`CREATE TABLE IF NOT EXISTS local_events (
          execution_id TEXT NOT NULL, sequence INTEGER NOT NULL, body TEXT NOT NULL,
          PRIMARY KEY(execution_id, sequence)
        ) WITHOUT ROWID`);
        this.db.exec("PRAGMA user_version=2");
        this.db.exec(`
          CREATE INDEX IF NOT EXISTS local_execution_session ON entities(kind,json_extract(body,'$.sessionId'));
          CREATE INDEX IF NOT EXISTS local_execution_operation ON entities(kind,json_extract(body,'$.operationId'));
          CREATE INDEX IF NOT EXISTS local_execution_status ON entities(kind,json_extract(body,'$.status'));
          CREATE TABLE IF NOT EXISTS event_cache_sizes(execution_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL, count INTEGER NOT NULL);
          CREATE TRIGGER IF NOT EXISTS event_cache_insert AFTER INSERT ON local_events BEGIN
            INSERT INTO event_cache_sizes VALUES(NEW.execution_id,length(CAST(NEW.body AS BLOB)),1)
            ON CONFLICT(execution_id) DO UPDATE SET bytes=bytes+excluded.bytes,count=count+1;
          END;
          CREATE TRIGGER IF NOT EXISTS event_cache_delete AFTER DELETE ON local_events BEGIN
            UPDATE event_cache_sizes SET bytes=bytes-length(CAST(OLD.body AS BLOB)),count=count-1 WHERE execution_id=OLD.execution_id;
            DELETE FROM event_cache_sizes WHERE execution_id=OLD.execution_id AND count=0;
          END;
        `);
      });
    } catch (error) {
      this.db.close();
      throw error;
    }
  }

  /** Engine 已持有事务时复用它，避免嵌套 BEGIN；所有写入同步完成。 */
  override transaction<T>(fn: () => T): T {
    if (this.transactionDepth) return fn();
    this.transactionDepth++;
    try {
      return super.transaction(fn);
    } finally {
      this.transactionDepth--;
    }
  }

  private insertEvent(id: string, event: any) {
    // 容量压力下拒绝缓存新增正文，业务事实仍由 put 可靠落账。
    const accounting = this.db
      .prepare("SELECT name FROM sqlite_master WHERE name='event_cache_sizes'")
      .get();
    if (accounting) {
      const bytes = Buffer.byteLength(JSON.stringify(event));
      const total = Number(
        this.db
          .prepare("SELECT COALESCE(SUM(bytes),0) AS n FROM event_cache_sizes")
          .get()!.n,
      );
      if (bytes > 8 * 1024 * 1024 || total + bytes > 64 * 1024 * 1024) {
        const old = this.findBy("localExecutions", "id", id)[0];
        if (old) super.put("localExecutions", { gap: true }, id);
        return false;
      }
    }
    this.db
      .prepare("INSERT INTO local_events VALUES(?,?,?)")
      .run(id, event.sequence, JSON.stringify(event));
    return true;
  }

  /** 默认实体只返回账本；正文必须通过显式、有界的缓存入口读取。 */
  override executionEvents(id: string): any[] {
    return (
      this.db
        .prepare(
          "SELECT body FROM local_events WHERE execution_id=? ORDER BY sequence",
        )
        .all(id) as { body: string }[]
    ).map((row) => JSON.parse(row.body));
  }

  override put(
    kind: string,
    data: Partial<Entity>,
    id: string = randomUUID(),
    expected?: number,
  ): Entity {
    if (kind !== "localExecutions") return super.put(kind, data, id, expected);
    return this.transaction(() => {
      const previous = this.findBy(kind, "id", id)[0];
      let runtimeConfig = data.runtimeConfig ?? previous?.runtimeConfig;
      let reply = data.reply ?? previous?.reply;
      const events = Array.isArray(data.events) ? data.events : [];
      let gap = previous?.gap || data.gap || false;
      // 业务事实独立于可淘汰缓存，在同一事务中先提取再约束容量。
      for (const event of events) {
        if (event.type === "runtime/config") runtimeConfig = event.data;
        if (event.type === "result" && event.data?.result)
          reply = event.data.result;
        if (
          event.type === "item/completed" &&
          event.data?.item?.type === "agentMessage" &&
          !isCodexAsyncQuestion(event.data.item)
        )
          reply = event.data.item.text;
        if (
          event.sequence > (previous?.sequence ?? -1) &&
          !this.insertEvent(id, event)
        )
          gap = true;
      }
      const result = super.put(
        kind,
        {
          ...data,
          gap,
          runtimeConfig,
          reply,
          events: [],
          eventsExternal: true,
        },
        id,
        expected,
      );
      this.trimExecution(id);
      return super.get(kind, id);
    });
  }

  /** 必要事实已在写入事务中独立保存，淘汰仅标记缺口，不延长保留期。 */
  private markGap(id: string) {
    this.db
      .prepare(
        "UPDATE entities SET body=json_set(body,'$.gap',json('true')) WHERE kind='localExecutions' AND id=?",
      )
      .run(id);
  }
  /** 写入时严格限制单执行容量；超大事件只留下明确序号缺口。 */
  private trimExecution(id: string) {
    const size = this.db
      .prepare("SELECT bytes,count FROM event_cache_sizes WHERE execution_id=?")
      .get(id) as any;
    if (!size || (size.bytes <= 8 * 1024 * 1024 && size.count <= 1000)) return;
    this.markGap(id);
    const rows = this.db
      .prepare(
        "SELECT sequence,length(CAST(body AS BLOB)) AS bytes FROM local_events WHERE execution_id=? ORDER BY sequence DESC",
      )
      .all(id) as any[];
    let bytes = 0,
      count = 0;
    for (const row of rows) {
      bytes += row.bytes;
      count++;
      if (count > 1000 || bytes > 8 * 1024 * 1024)
        this.db
          .prepare(
            "DELETE FROM local_events WHERE execution_id=? AND sequence=?",
          )
          .run(id, row.sequence);
    }
  }
  /** 维护在执行线程空闲时小批提交；不压缩全库、不依赖页面确认。 */
  maintainEvents(now = Date.now()) {
    return this.transaction(() => {
      const deadline = performance.now() + 10;
      let removed = 0;
      const total = () =>
        Number(
          this.db
            .prepare(
              "SELECT COALESCE(SUM(bytes),0) AS n FROM event_cache_sizes",
            )
            .get()!.n,
        );
      let bytes = total();
      const candidates = this.db
        .prepare(
          `SELECT e.id,json_extract(e.body,'$.status') AS status,json_extract(e.body,'$.updatedAt') AS updatedAt,c.bytes,c.count
        FROM event_cache_sizes c JOIN entities e ON e.id=c.execution_id
        WHERE c.count>0 AND (? OR c.bytes>8388608 OR c.count>1000 OR
          (json_extract(e.body,'$.status') IN ('completed','failed','cancelled') AND json_extract(e.body,'$.updatedAt')<?))
        ORDER BY CASE WHEN json_extract(e.body,'$.status') IN ('completed','failed','cancelled') THEN 0 ELSE 1 END,e.rowid LIMIT 500`,
        )
        .all(
          bytes > 56 * 1024 * 1024 ? 1 : 0,
          new Date(now - 86400000).toISOString(),
        ) as any[];
      for (const row of candidates) {
        const entity = row;
        const expired =
          ["completed", "failed", "cancelled"].includes(entity.status) &&
          Date.parse(entity.updatedAt) < now - 86400000;
        if (
          !expired &&
          bytes <= 56 * 1024 * 1024 &&
          row.bytes <= 8 * 1024 * 1024 &&
          row.count <= 1000
        )
          continue;
        this.markGap(row.id);
        const events = this.db
          .prepare(
            "SELECT sequence,length(CAST(body AS BLOB)) AS bytes FROM local_events WHERE execution_id=? ORDER BY sequence LIMIT ?",
          )
          .all(row.id, 500 - removed) as any[];
        for (const event of events) {
          if (
            !expired &&
            bytes <= 56 * 1024 * 1024 &&
            row.bytes <= 8 * 1024 * 1024 &&
            row.count <= 1000
          )
            break;
          this.db
            .prepare(
              "DELETE FROM local_events WHERE execution_id=? AND sequence=?",
            )
            .run(row.id, event.sequence);
          bytes -= event.bytes;
          row.bytes -= event.bytes;
          row.count--;
          removed++;
        }
        if (removed >= 500 || performance.now() >= deadline) break;
      }
      return removed;
    });
  }

  override remove(kind: string, id: string) {
    this.transaction(() => {
      super.remove(kind, id);
      if (kind === "localExecutions")
        this.db
          .prepare("DELETE FROM local_events WHERE execution_id=?")
          .run(id);
    });
  }
}
