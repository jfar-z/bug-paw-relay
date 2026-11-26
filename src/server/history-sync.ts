import { isDeepStrictEqual } from "node:util";

/** 用同一执行的原生结束事件核对历史。缺少定位依据时由页面显示未确认并允许重试。 */
export function terminalHistoryState(history: any, executionId: string, runtime: string) {
  if (history.historyError) return "unverified";
  const events: any[] = (history.events ?? []).filter((e: any) => e.executionId === executionId);
  // 当前执行的事件开头可能被补传窗口淘汰，不能根据残余事件推断整轮完整。
  if (!events.length || events.some((e, index) => e.sequence !== index + 1)) return "unverified";
  if (runtime === "claude") {
    if (!events.some(e => e.type === "result")) return "unverified";
    const blocks = events.filter(e => ["assistant", "user"].includes(e.type) && e.data?.message);
    if (!blocks.some(e => e.type === "assistant") || blocks.some(e => !e.data.uuid)) return "unverified";
    const native = new Map<string, any>((Array.isArray(history.nativeHistory) ? history.nativeHistory : [])
      .map((m: any) => [m.uuid, m]));
    return blocks.every(({ data, type }) => {
      const row = native.get(data.uuid);
      return row?.type === type && isDeepStrictEqual(row.message?.content, data.message.content);
    }) ? "confirmed" : "pending";
  }

  const ends = events.filter(e => e.type === "turn/completed").map(e => e.data?.turn);
  if (!ends.length || ends.some(turn => !turn?.id)) return "unverified";
  const ended = new Set(ends.map(turn => turn.id));
  if (events.some(e => e.type === "turn/started" && !ended.has(e.data?.turn?.id))) return "unverified";
  if (events.some(e => e.type === "item/completed" && !ended.has(e.data?.turnId))) return "unverified";
  const turns = new Map<string, any>((history.nativeHistory?.thread?.turns ?? []).map((t: any) => [t.id, t]));
  for (const end of ends) {
    const turn = turns.get(end.id);
    if (!turn || turn.status !== end.status) return "pending";
    const items = new Map<string, any>((turn.items ?? []).map((item: any) => [item.id, item]));
    const completed = events.filter(e => e.type === "item/completed" && e.data?.turnId === end.id)
      .map(e => e.data.item);
    const expected = [...completed, ...(end.items ?? [])];
    if (!expected.length) return "unverified";
    for (const item of expected) {
      const stored = items.get(item?.id);
      if (!stored || stored.type !== item.type) return "pending";
      // 看板输入在原生历史中会投影为用户可见文本，绑定执行号后只核对身份。
      if (item.type === "userMessage" && stored.relayExecutionId === executionId) continue;
      if (!Object.entries(item).every(([key, value]) => isDeepStrictEqual(stored[key], value))) return "pending";
    }
  }
  return "confirmed";
}
