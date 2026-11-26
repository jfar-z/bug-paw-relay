import { FeedbackError, feedback } from "./locale.js";
import { messages } from "../shared/i18n.js";
import { useEffect, useRef, useState } from "react";
import { api } from "./api.js";

/** 拖动功能资源沿用现有阶段文案的语言入口。 */
export const dragMessages = {
  "zh-CN": {
    hint: messages["board.drag.hint"]["zh-CN"],
    drop: messages["board.drag.drop"]["zh-CN"],
    moving: messages["board.drag.moving"]["zh-CN"],
    pending: messages["board.drag.pending"]["zh-CN"],
    blocked: messages["board.drag.blocked"]["zh-CN"],
    optional: messages["board.drag.optional"]["zh-CN"],
    required: messages["board.drag.required"]["zh-CN"],
    empty: messages["board.drag.empty"]["zh-CN"],
    changed: messages["board.drag.changed"]["zh-CN"],
    unknown: messages["board.drag.unknown"]["zh-CN"],
    submit: messages["board.drag.submit"]["zh-CN"],
    instruction: messages["board.drag.instruction"]["zh-CN"],
  },
  en: {
    hint: messages["board.drag.hint"]["en"],
    drop: messages["board.drag.drop"]["en"],
    moving: messages["board.drag.moving"]["en"],
    pending: messages["board.drag.pending"]["en"],
    blocked: messages["board.drag.blocked"]["en"],
    optional: messages["board.drag.optional"]["en"],
    required: messages["board.drag.required"]["en"],
    empty: messages["board.drag.empty"]["en"],
    changed: messages["board.drag.changed"]["en"],
    unknown: messages["board.drag.unknown"]["en"],
    submit: messages["board.drag.submit"]["en"],
    instruction: messages["board.drag.instruction"]["en"],
  },
};
export function dragText(key: keyof typeof dragMessages.en) {
  return dragMessages[
    document.documentElement.lang.startsWith("en") ? "en" : "zh-CN"
  ][key];
}
/** 与服务端手动推进的忙碌集合一致，queued 仍允许取消后流转。 */
export function canDrag(item: any, board: any, state: any) {
  const stage = board?.stages.find((s: any) => s.id === item.stageId);
  const execution = state.executions?.find(
    (e: any) => e.id === item.executionId,
  );
  return (
    !item.archived &&
    stage &&
    stage.type !== "done" &&
    stage.targets?.length > 0 &&
    !["dispatching", "running", "waiting", "unknown", "stopping"].includes(
      execution?.state || item.status,
    )
  );
}
const unresolved = new Map<string, any>();
const sending = new Set<string>();
/** 结果不明时先回读；保留同一请求，绝不把旧意图套用到新版本。 */
export async function advanceItem(
  item: any,
  targetId: string,
  record: string,
  prepare?: (operationId: string) => Promise<object>,
  draftId = "",
) {
  if (sending.has(item.id)) return;
  sending.add(item.id);
  try {
    const previous = unresolved.get(item.id);
    let payload = previous?.payload;
    if (payload) {
      const { item: current } = await api("/boards/" + item.boardId + "/items/" + item.id, undefined, undefined, 15000);
      if (!current || current.version !== payload.expectedVersion) {
        unresolved.delete(item.id);
        throw new FeedbackError(feedback("board.drag.changed"));
      }
      if (
        payload.targetId !== targetId ||
        payload.record !== record ||
        draftId !== previous.draftId
      )
        throw new FeedbackError(feedback("board.drag.unknown"));
    } else {
      payload = {
        targetId,
        record,
        operationId: crypto.randomUUID(),
        expectedStageId: item.stageId,
        expectedVersion: item.version,
      };
      if (prepare) Object.assign(payload, await prepare(payload.operationId));
    }
    unresolved.set(item.id, { payload, draftId });
    try {
      await api("/items/" + item.id + "/advance", payload, undefined, 15000);
      unresolved.delete(item.id);
    } catch (error: any) {
      if (error.status && error.status < 500) unresolved.delete(item.id);
      else {
        let changed = false;
        try {
          const { item: current } = await api("/boards/" + item.boardId + "/items/" + item.id, undefined, undefined, 15000);
          if (!current || current.version !== payload.expectedVersion) {
            unresolved.delete(item.id);
            changed = true;
          }
        } catch {
          // 无法回读时保留操作标识，下一次重试仍需先核实。
        }
        throw new FeedbackError(
          feedback(changed ? "board.drag.changed" : "board.drag.unknown"),
        );
      }
      throw error;
    }
  } finally {
    sending.delete(item.id);
  }
}

/** 鼠标阈值拖动与触屏长按共用命中、取消和边缘滚动，不接管普通滑动。 */
export function useBoardDrag(onDrop: (item: any, target: string) => void) {
  const root = useRef<HTMLDivElement>(null);
  const session = useRef<any>(null);
  const callback = useRef(onDrop);
  callback.current = onDrop;
  const suppress = useRef(0);
  const [drag, setDrag] = useState<any>(null);
  useEffect(() => {
    let frame = 0;
    const hit = (s: any) => {
      const lane = document
        .elementFromPoint(s.x, s.y)
        ?.closest<HTMLElement>("[data-drop-stage]");
      s.target =
        lane &&
        root.current?.contains(lane) &&
        s.targets.includes(lane.dataset.dropStage) &&
        lane.dataset.dropStage !== s.item.stageId
          ? lane.dataset.dropStage
          : "";
      setDrag({ item: s.item, target: s.target, x: s.x, y: s.y });
    };
    const scroll = () => {
      const s = session.current;
      if (s?.active && root.current) {
        const r = root.current.getBoundingClientRect();
        const left = Math.max(0, r.left),
          right = Math.min(innerWidth, r.right);
        root.current.scrollLeft +=
          s.x < left + 48 ? -12 : s.x > right - 48 ? 12 : 0;
        // 先滚动指针所在泳道的卡片区，再回退到页面，避免只滚动祖先。
        const lane = document
          .elementFromPoint(s.x, s.y)
          ?.closest<HTMLElement>("[data-drop-stage]");
        let el: HTMLElement | null =
          lane && root.current.contains(lane)
            ? lane.querySelector<HTMLElement>(".column-items")
            : root.current;
        while (el) {
          const bounds = el.getBoundingClientRect();
          if (
            el.scrollHeight > el.clientHeight &&
            /auto|scroll/.test(getComputedStyle(el).overflowY)
          )
            el.scrollTop +=
              s.y < Math.max(0, bounds.top) + 48
                ? -10
                : s.y > Math.min(innerHeight, bounds.bottom) - 48
                  ? 10
                  : 0;
          el = el.parentElement;
        }
        hit(s);
      }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
    const move = (x: number, y: number, event: Event) => {
      const s = session.current;
      if (!s) return;
      s.x = x;
      s.y = y;
      if (!s.active && Math.hypot(x - s.startX, y - s.startY) > 8) {
        if (s.touch) {
          clearTimeout(s.timer);
          session.current = null;
          return;
        }
        s.active = true;
      }
      if (s.active) {
        event.preventDefault();
        hit(s);
      }
    };
    const mouse = (e: MouseEvent) => move(e.clientX, e.clientY, e);
    const touch = (e: TouchEvent) => {
      if (e.touches.length !== 1) {
        end(false);
        return;
      }
      move(e.touches[0].clientX, e.touches[0].clientY, e);
    };
    const end = (commit: boolean) => {
      const s = session.current;
      if (!s) return;
      clearTimeout(s.timer);
      session.current = null;
      setDrag(null);
      if (s.active) {
        suppress.current = Date.now() + 700;
        if (commit && s.target) callback.current(s.item, s.target);
      }
    };
    const up = () => end(true),
      cancel = () => end(false);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") end(false);
    };
    window.addEventListener("mousemove", mouse);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", touch, { passive: false });
    window.addEventListener("touchend", up);
    window.addEventListener("touchcancel", cancel);
    window.addEventListener("keydown", key);
    window.addEventListener("blur", cancel);
    window.addEventListener("hashchange", cancel);
    return () => {
      cancel();
      cancelAnimationFrame(frame);
      window.removeEventListener("mousemove", mouse);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", touch);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", cancel);
      window.removeEventListener("keydown", key);
      window.removeEventListener("blur", cancel);
      window.removeEventListener("hashchange", cancel);
    };
  }, []);
  const start = (
    item: any,
    targets: string[],
    x: number,
    y: number,
    touch: boolean,
  ) => {
    if (session.current) return;
    const s = {
      item: { ...item },
      targets: [...targets],
      x,
      y,
      startX: x,
      startY: y,
      touch,
      active: false,
      target: "",
      timer: 0,
    };
    session.current = s;
    if (touch)
      s.timer = window.setTimeout(() => {
        s.active = true;
        setDrag({ item: s.item, x, y, target: "" });
      }, 400);
  };
  return { root, drag, start, suppress };
}
