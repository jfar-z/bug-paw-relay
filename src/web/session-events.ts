/** 页面与工作台工具共用原生历史及事件去重逻辑。 */
export * from "../shared/session-events.js";

type Publication = { id: string; executionId?: string | null; createdAt: string; boardCard?: boolean };
type ExecutionStart = { id: string; createdAt: string };

/** 用原生标识与执行事件定位发布，没有唯一轮次时按已有时间边界插入独立记录。 */
export function sessionPublicationEvents<T extends Publication>(
  events: any[],
  versions: T[],
  history: {
    events?: any[];
    executionStarts?: ExecutionStart[];
    gap?: boolean;
    nativeHistory?: unknown;
  } | null,
) {
  if (!versions.length) return events;
  const executionStarts = new Map(
    history?.executionStarts?.map(({ id, createdAt }) => [id, Date.parse(createdAt)]),
  );
  const nativeTurns = new Map<string, Set<string>>();
  const turnExecutions = new Map<string, string | null>();
  for (const event of history?.events || []) {
    const turnId = event.data?.turnId || event.data?.turn?.id;
    if (!turnId || !event.executionId) continue;
    const turns = nativeTurns.get(event.executionId) ?? new Set<string>();
    turns.add(turnId);
    nativeTurns.set(event.executionId, turns);
    if (!turnExecutions.has(turnId)) turnExecutions.set(turnId, event.executionId);
    else if (turnExecutions.get(turnId) !== event.executionId)
      turnExecutions.set(turnId, null);
  }

  const positions = new Map<string, number | null>();
  const anchors: { position: number; time: number }[] = [];
  const executions = new Set<string>();
  let turnId: string | undefined;
  let start = 0;
  let time: number | undefined;
  let fallbackTime: number | undefined;
  const closeTurn = (end: number) => {
    if (end === start) return;
    for (const execution of executions) {
      positions.set(execution, executions.size === 1 && !positions.has(execution) ? end : null);
    }
    const timestamp = time ?? fallbackTime;
    if (timestamp !== undefined) anchors.push({ position: start, time: timestamp });
    start = end;
    turnId = time = fallbackTime = undefined;
    executions.clear();
  };

  for (const [index, event] of events.entries()) {
    if (event.type === "user" || (turnId && event.turnId && turnId !== event.turnId))
      closeTurn(index);
    turnId ??= event.turnId;
    if (Number.isFinite(event.timestamp)) time ??= event.timestamp;
    const executionId = event.executionId || turnExecutions.get(event.turnId);
    if (executionId) {
      executions.add(executionId);
      const startedAt = executionStarts.get(executionId);
      if (startedAt !== undefined && Number.isFinite(startedAt))
        fallbackTime ??= startedAt;
    }
  }
  closeTurn(events.length);

  const insertions = new Map<number, T[]>();
  const sorted = [...new Map(versions.map((version) => [version.id, version])).values()]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  for (const version of sorted) {
    const execution = version.executionId;
    const attached = execution && (nativeTurns.get(execution)?.size ?? 0) <= 1
      ? positions.get(execution)
      : undefined;
    const publishedAt = Date.parse(version.createdAt);
    const first = anchors[0];
    // 只有缓冲区的更早历史尚未返回时，等对应记录一起显示；离线仍保留打开入口。
    if (attached == null && history?.gap && !history.nativeHistory && first &&
      first.position === 0 && publishedAt < first.time) continue;

    const next = anchors.find((anchor) => anchor.time > publishedAt);
    const position = attached ?? next?.position ?? (first ? events.length : 0);
    const rows = insertions.get(position) ?? [];
    rows.push(version);
    insertions.set(position, rows);
  }
  const entriesAt = (position: number) =>
    insertions.get(position)?.map((version) => ({
      type: version.boardCard ? "board-card" : "light-publication",
      id: (version.boardCard ? "board:" : "light:") + version.id,
      version,
    })) ?? [];
  return events.flatMap((event, index) => [...entriesAt(index), event])
    .concat(entriesAt(events.length));
}
