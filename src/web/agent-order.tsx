import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type ReactNode,
} from "react";
import { GripVertical } from "lucide-react";
import { IconButton } from "./ui/index.js";
import { t as tr } from "./locale.js";

type Agent = { id: string; name: string };
type Gesture = {
  id: string;
  pointer: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  active: boolean;
};

/** 目标索引始终对应松手后的最终位置，首尾与键盘移动共用同一算法。 */
function move<T>(items: T[], from: number, to: number) {
  const result = items.slice();
  result.splice(to, 0, ...result.splice(from, 1));
  return result;
}

export function AgentOrderList<T extends Agent>({
  agents,
  sortable,
  saving,
  save,
  render,
}: {
  agents: T[];
  sortable: boolean;
  saving: boolean;
  save: (ids: string[]) => void;
  render: (agent: T) => ReactNode;
}) {
  const root = useRef<HTMLDivElement>(null);
  const gesture = useRef<Gesture | null>(null);
  const [preview, setPreview] = useState<{ id: string; index: number } | null>(
    null,
  );
  const frame = useRef(0);
  const focusId = useRef("");
  const signature = JSON.stringify(agents.map((a) => a.id));
  const suppressClick = useRef(false);

  function cancel() {
    cancelAnimationFrame(frame.current);
    gesture.current = null;
    setPreview(null);
  }

  useEffect(() => {
    cancel();
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    window.addEventListener("keydown", escape);
    window.addEventListener("blur", cancel);
    return () => {
      cancelAnimationFrame(frame.current);
      window.removeEventListener("keydown", escape);
      window.removeEventListener("blur", cancel);
    };
  }, [signature, sortable]);

  useLayoutEffect(() => {
    if (focusId.current && !saving) {
      if (document.activeElement === document.body)
        root.current
          ?.querySelector<HTMLElement>(
            `[data-agent-id="${focusId.current}"] .agent-grip button`,
          )
          ?.focus();
      focusId.current = "";
    }
  }, [signature, saving]);

  function indexAt(g: Gesture, scroll = false) {
    const list = root.current!;
    const box = list.getBoundingClientRect();
    if (g.x < box.left || g.x > box.right || g.y < box.top || g.y > box.bottom)
      return -1;
    const horizontal = getComputedStyle(list).display === "flex";
    if (scroll && horizontal) {
      if (g.x < box.left + 30) list.scrollLeft -= 9;
      else if (g.x > box.right - 30) list.scrollLeft += 9;
    } else if (scroll) {
      // 桌面列表使用页面滚动容器，触屏横向卡片仅滚动自身。
      const pane = list.closest(".content");
      const bounds = pane?.getBoundingClientRect();
      if (bounds && g.y < bounds.top + 35) pane?.scrollBy(0, -9);
      else if (bounds && g.y > bounds.bottom - 35) pane?.scrollBy(0, 9);
    }
    let index = 0;
    for (const row of list.children) {
      if ((row as HTMLElement).dataset.agentId === g.id) continue;
      const r = row.getBoundingClientRect();
      if (horizontal ? g.x < r.left + r.width / 2 : g.y < r.top + r.height / 2)
        break;
      index++;
    }
    return index;
  }

  function track() {
    const g = gesture.current;
    if (!g?.active) return;
    const target = indexAt(g, true);
    setPreview((prev) =>
      target < 0
        ? null
        : prev?.index === target && prev.id === g.id
          ? prev
          : { id: g.id, index: target },
    );
    frame.current = requestAnimationFrame(track);
  }

  function start(e: PointerEvent, id: string, handle: boolean) {
    if (
      !sortable ||
      saving ||
      agents.length < 2 ||
      !e.isPrimary ||
      e.button !== 0 ||
      (!handle && e.pointerType !== "mouse")
    )
      return;
    suppressClick.current = false;
    gesture.current = {
      id,
      pointer: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      active: false,
    };
    // 普通卡片点击保留浏览器原有目标；越过拖动阈值后再捕获指针。
    if (handle) root.current!.setPointerCapture(e.pointerId);
  }

  const from = preview ? agents.findIndex((a) => a.id === preview.id) : -1;
  const rows =
    preview && from >= 0 ? move(agents, from, preview.index) : agents;
  return (
    <div
      id="agent-results"
      ref={root}
      onDragStart={(e) => e.preventDefault()}
      onPointerMove={(e) => {
        const g = gesture.current;
        if (!g || g.pointer !== e.pointerId || !e.buttons) return;
        g.x = e.clientX;
        g.y = e.clientY;
        if (!g.active && Math.hypot(g.x - g.startX, g.y - g.startY) >= 4) {
          g.active = true;
          suppressClick.current = true;
          root.current!.setPointerCapture(e.pointerId);
          track();
        }
      }}
      onClickCapture={(e) => {
        if (suppressClick.current) {
          e.preventDefault();
          e.stopPropagation();
          suppressClick.current = false;
        }
      }}
      onPointerDownCapture={() => {
        suppressClick.current = false;
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerUp={(e) => {
        const g = gesture.current;
        if (!g || g.pointer !== e.pointerId) return;
        const target = g.active
          ? indexAt({ ...g, x: e.clientX, y: e.clientY })
          : -1;
        const source = agents.findIndex((a) => a.id === g.id);
        cancel();
        if (source >= 0 && target >= 0 && target !== source)
          save(move(agents, source, target).map((a) => a.id));
      }}
    >
      {rows.map((a) => (
        <div
          key={a.id}
          data-agent-id={a.id}
          className={
            "agent-order-row" + (preview?.id === a.id ? " agent-order-gap" : "")
          }
          onPointerDown={(e) =>
            start(e, a.id, !!(e.target as Element).closest(".agent-grip"))
          }
        >
          {render(a)}
          {sortable && agents.length > 1 && (
            <span className="agent-grip">
              <IconButton
                label={tr("web.agentOrder.handle", { name: a.name })}
                icon={<GripVertical size={16} />}
                aria-disabled={saving}
                onKeyDown={(e) => {
                  const delta = ["ArrowUp", "ArrowLeft"].includes(e.key)
                    ? -1
                    : ["ArrowDown", "ArrowRight"].includes(e.key)
                      ? 1
                      : 0;
                  if (!delta) return;
                  e.preventDefault();
                  const index = agents.findIndex((entry) => entry.id === a.id);
                  if (
                    saving ||
                    index + delta < 0 ||
                    index + delta >= agents.length
                  )
                    return;
                  focusId.current = a.id;
                  save(
                    move(agents, index, index + delta).map((entry) => entry.id),
                  );
                }}
              />
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
