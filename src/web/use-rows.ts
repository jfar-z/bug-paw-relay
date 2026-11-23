import { useState, useRef, useEffect, useCallback } from "react";
import { api, pollVisible } from "./api.js";
import { caughtFeedback, type UiFeedback } from "./locale.js";

/** 定期校准独立于来源环境的索引，查询切换后忽略旧响应。 */
export function useRows<T>(path: string, interval = 5000) {
  const [result, setResult] = useState<{
    path: string;
    rows?: T[];
    error?: UiFeedback;
  }>();
  const sequence = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    pending.current = true;
    try {
      const rows: T[] = await api(path, undefined, undefined, 10000);
      if (request === sequence.current) setResult({ path, rows });
      // 实时通知可能并行刷新列表，显式调用仍需取得自己的确认范围。
      return rows;
    } catch (error) {
      if (request === sequence.current)
        setResult((previous) => ({
          path,
          rows: previous?.path === path ? previous.rows : undefined,
          error: caughtFeedback(error),
        }));
    } finally {
      if (request === sequence.current) pending.current = false;
    }
  }, [path]);
  useEffect(() => {
    if (!path) return;
    const stop = pollVisible(
      async () => {
        if (!pending.current) await refresh();
      },
      interval,
      ["focus"],
    );
    return () => {
      ++sequence.current;
      stop();
    };
  }, [path, refresh, interval]);
  return { ...(result?.path === path ? result : undefined), refresh };
}
