import { message as i18nMessage } from "../shared/i18n.js";
import { DatabaseSync, backup } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { numberStages } from "./stage-numbering.js";
import { stageSchema } from "../shared/contracts.js";
import {
  AppError,
  type Entity,
  type WorkbenchSessionSummary,
} from "../shared/contracts.js";
/** 单实例 SQLite 存储；同步事务用于版本竞争与操作防重，不跨异步网络调用。 */
export class Store {
  db: DatabaseSync;
  constructor(
    path: string,
    boardData = true,
    supportedVersion = boardData ? 3 : 1,
  ) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;",
    );
    const version = (this.db.prepare("PRAGMA user_version").get() as any)
      .user_version;
    const upgradeFixedStart =
      boardData && version === 2 && supportedVersion === 3;
    if (version !== 0 && version < supportedVersion && !upgradeFixedStart) {
      this.db.close();
      throw new AppError(
        "STORE_UPGRADE_REQUIRED",
        i18nMessage("errors.STORE_UPGRADE_REQUIRED"),
      );
    }
    if (version > supportedVersion) {
      this.db.close();
      throw new Error("数据库版本高于当前程序，禁止降级启动");
    }
    this.db.exec(`BEGIN IMMEDIATE;
   CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL,id TEXT PRIMARY KEY,owner TEXT NOT NULL,body TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS entity_kind ON entities(kind,owner);
   DROP INDEX IF EXISTS active_connector_update;
   CREATE UNIQUE INDEX active_connector_update ON entities(json_extract(body,'$.environmentId')) WHERE kind='connectorUpdates' AND json_extract(body,'$.state') NOT IN ('succeeded','failed','rolled_back','recovered');
   CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,scope TEXT NOT NULL,hash TEXT NOT NULL,state TEXT NOT NULL,result TEXT);
   CREATE TABLE IF NOT EXISTS executions(id TEXT PRIMARY KEY,item_id TEXT,session_id TEXT NOT NULL,environment_id TEXT NOT NULL,state TEXT NOT NULL,snapshot TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE UNIQUE INDEX IF NOT EXISTS active_item ON executions(item_id) WHERE state IN ('queued','dispatching','running','waiting','unknown','stopping');
   CREATE TABLE IF NOT EXISTS auth_sessions(hash TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS invitations(hash TEXT PRIMARY KEY,expires INTEGER NOT NULL,used INTEGER NOT NULL DEFAULT 0);
   COMMIT;`);
    // SQLite 为既有工作台会话一次性建立摘要索引，轮询时无需读取正文页。
    if (boardData)
      this.db
        .exec(`CREATE INDEX IF NOT EXISTS workbench_session_summary ON entities(
        json_extract(body, '$.archivedAt'), id, json_extract(body, '$.title'),
        json_extract(body, '$.status'), json_extract(body, '$.version'),
        json_extract(body, '$.createdAt'), json_extract(body, '$.lastUserMessageAt')
      ) WHERE kind='workbench'`);
    if (upgradeFixedStart) {
      try {
        this.transaction(() => {
          for (const board of this.list("boards")) {
            // 只补入新身份，不把任何同名普通阶段认作起点，不触碰在途账本。
            if (board.stages.some((stage: any) => stage.fixedRole === "start"))
              continue;
            const target =
              board.stages.find((stage: any) => stage.type !== "done") ??
              board.stages[0];
            const start = stageSchema.parse({
              id: randomUUID(),
              fixedRole: "start",
              type: "human",
              name: "Not started",
              nameKey: "board.stage.notStarted",
              targets: target ? [target.id] : [],
            });
            const data = { stages: [start, ...board.stages] };
            numberStages(data, board);
            this.put("boards", data, board.id, board.version);
          }
          this.db.exec("PRAGMA user_version=3");
        });
      } catch (error) {
        this.db.close();
        throw error;
      }
    }
    // 新库直接标记当前结构，不再运行开发期看板编号修复。
    if (version === 0) this.db.exec(`PRAGMA user_version=${supportedVersion}`);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  list<T extends Entity = Entity>(kind: string): T[] {
    return (
      this.db
        .prepare("SELECT body FROM entities WHERE kind=? ORDER BY rowid")
        .all(kind) as any[]
    ).map((r) => JSON.parse(r.body));
  }
  /** 新会话和未写入归档时间的旧会话均位于最近列表。 */
  listWorkbenchSummaries(archived: boolean): WorkbenchSessionSummary[] {
    const rows = this.db
      .prepare(
        `
      SELECT id, json_extract(body, '$.title') AS title,
        json_extract(body, '$.status') AS status, json_extract(body, '$.version') AS version,
        json_extract(body, '$.archivedAt') AS archivedAt, json_extract(body, '$.createdAt') AS createdAt,
        json_extract(body, '$.lastUserMessageAt') AS lastUserMessageAt
      FROM entities INDEXED BY workbench_session_summary
      WHERE kind='workbench' AND archivedAt IS ${archived ? "NOT NULL" : "NULL"}
    `,
      )
      .all();
    return rows as unknown as WorkbenchSessionSummary[];
  }
  /** 按受控字段在数据库内过滤，避免读取无关会话正文。 */
  findBy(
    kind: string,
    field: "environmentId" | "id" | "sessionId" | "operationId" | "status" | "appId" | "versionId" | "itemId" | "boardId" | "executionId",
    value: string,
  ): Entity[] {
    const expression =
      field === "id" ? "id" : `json_extract(body, '$.${field}')`;
    return (
      this.db
        .prepare(
          `SELECT body FROM entities WHERE kind=? AND ${expression}=? ORDER BY rowid`,
        )
        .all(kind, value) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  /** 通用账本的显式事件读取；环境数据库覆盖为独立缓存查询。 */
  executionEvents(id: string): any[] {
    return this.get("localExecutions", id).events || [];
  }
  /** 运行配置是独立业务事实，不依赖可淘汰事件缓存。 */
  executionRuntimeConfig(id: string): any {
    return this.get("localExecutions", id).runtimeConfig;
  }
  get<T extends Entity = Entity>(kind: string, id: string): T {
    const row = this.db
      .prepare("SELECT body FROM entities WHERE kind=? AND id=?")
      .get(kind, id) as any;
    if (!row)
      throw new AppError(
        "NOT_FOUND",
        i18nMessage("errors.NOT_FOUND.record.not.found"),
        404,
      );
    return JSON.parse(row.body);
  }
  put(
    kind: string,
    data: Partial<Entity>,
    id: string = randomUUID(),
    expected?: number,
  ): Entity {
    const old = this.db
      .prepare("SELECT kind,body FROM entities WHERE id=?")
      .get(id) as any;
    if (old && old.kind !== kind)
      throw new AppError(
        "CONFLICT",
        i18nMessage("errors.CONFLICT.the.data.has.changed.refresh.and"),
        409,
      );
    const previous = old ? JSON.parse(old.body) : null;
    if (expected !== undefined && previous?.version !== expected)
      throw new AppError(
        "CONFLICT",
        i18nMessage("errors.CONFLICT.the.data.has.changed.refresh.and"),
        409,
      );
    const now = new Date().toISOString();
    const result = {
      ...previous,
      ...data,
      id,
      ownerId: previous?.ownerId || "owner",
      version: (previous?.version || 0) + 1,
      createdAt: previous?.createdAt || now,
      updatedAt: now,
    };
    // SQL 同时守住类型边界，避免另一连接在读取后插入同 ID 时跨类覆盖。
    const written = this.db
      .prepare(
        "INSERT INTO entities(kind,id,owner,body) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body WHERE entities.kind=excluded.kind",
      )
      .run(kind, id, result.ownerId, JSON.stringify(result));
    if (!written.changes)
      throw new AppError(
        "CONFLICT",
        i18nMessage("errors.CONFLICT.the.data.has.changed.refresh.and"),
        409,
      );
    return result;
  }
  /** 仅执行生命周期允许显式改类；调用方必须在同步事务中完成正文和事件写入。 */
  promoteExecution(id: string, hash: string, sessionId: string) {
    const row = this.db
      .prepare("SELECT kind,body FROM entities WHERE id=?")
      .get(id) as any;
    if (!row) return;
    const prepared = JSON.parse(row.body);
    if (
      row.kind !== "preparedExecutions" ||
      prepared.hash !== hash ||
      prepared.sessionId !== sessionId
    )
      throw new AppError(
        "IDEMPOTENCY_CONFLICT",
        i18nMessage(
          "errors.IDEMPOTENCY_CONFLICT.operation.parameters.conflict",
        ),
      );
    if (prepared.status !== "queued")
      throw new AppError(
        "STALE_EXECUTION",
        i18nMessage(
          "errors.STALE_EXECUTION.the.queued.execution.was.cancelled",
        ),
      );
    this.db
      .prepare(
        "UPDATE entities SET kind='localExecutions' WHERE id=? AND kind='preparedExecutions'",
      )
      .run(id);
  }
  remove(kind: string, id: string) {
    this.get(kind, id);
    this.db.prepare("DELETE FROM entities WHERE kind=? AND id=?").run(kind, id);
  }
  async backup(path: string) {
    await backup(this.db, path);
  }
  close() {
    this.db.close();
  }
}
