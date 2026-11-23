import { Button } from "./ui/index.js";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SlidersHorizontal } from "lucide-react";
import { t as tr, useLocale } from "./locale.js";
import "./ui/session-configuration.css";

/** 只切换呈现方式，始终保留同一组配置组件和能力请求状态。 */
export function SessionConfiguration({
  sessionId,
  children,
}: {
  sessionId: string;
  children: (closeSignal: string) => ReactNode;
}) {
  useLocale();
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [collapsed, setCollapsed] = useState(true);
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const toolbar = root.current!.closest(".session-composer-toolbar")!;
    const measure = () => {
      const row = root.current!.parentElement!;
      const siblings = Array.from(row.children).filter(
        (el) => el !== root.current,
      );
      // 为最长模型保留 220px，三个图标及间距保留 138px，不靠无限压缩避免折叠。
      const required =
        358 +
        siblings.reduce(
          (sum, el) => sum + el.getBoundingClientRect().width + 4,
          0,
        ) +
        toolbar.lastElementChild!.getBoundingClientRect().width +
        12;
      setCollapsed(toolbar.clientWidth < required);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(toolbar);
    observer.observe(toolbar.lastElementChild!);
    for (const el of root.current!.parentElement!.children)
      if (el !== root.current) observer.observe(el);
    measure();
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setOpen(false);
    if (collapsed && panel.current?.contains(document.activeElement))
      trigger.current?.focus();
  }, [collapsed, sessionId]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (root.current?.closest(".composer")?.contains(target)) return;
      // 统一 Select 的列表通过 portal 渲染；关联列表仍属于本配置面板。
      const related = Array.from(
        panel.current!.querySelectorAll("[aria-controls]"),
      ).some((el) =>
        document
          .getElementById(el.getAttribute("aria-controls")!)
          ?.contains(target),
      );
      if (!related) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.defaultPrevented ||
        panel.current?.querySelector("dialog[open]")
      )
        return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className={`session-configuration${collapsed ? " collapsed" : ""}`}
    >
      {collapsed && (
        <Button
          shape="icon"
          variant="ghost"
          ref={trigger}
          type="button"

          aria-label={tr("web.sessionConfiguration")}
          title={tr("web.sessionConfiguration")}
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              requestAnimationFrame(() =>
                panel.current
                  ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                  ?.focus(),
              );
            }
          }}
        >
          <SlidersHorizontal size={18} aria-hidden="true" />
        </Button>
      )}
      <div
        ref={panel}
        id={id}
        className="session-configuration-panel"
        role={collapsed ? "region" : undefined}
        aria-label={tr("web.sessionConfiguration")}
        hidden={collapsed && !open}
      >
        {children(`${sessionId}:${collapsed}:${open}`)}
      </div>
    </div>
  );
}
