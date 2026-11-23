/** 用户消息决定会话顺序；空会话及缺少历史时间的旧记录固定按创建时间兜底。 */
export function compareSessionActivity(
  a: { id: string; lastUserMessageAt?: string | null; createdAt: string },
  b: { id: string; lastUserMessageAt?: string | null; createdAt: string },
): number {
  const time = (s: typeof a) =>
    Date.parse(s.lastUserMessageAt || s.createdAt) || 0;
  return time(b) - time(a) || a.id.localeCompare(b.id);
}
