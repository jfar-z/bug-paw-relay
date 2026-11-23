import { t as tr, useLocale, currentLocale, displayError } from "../locale.js";
import React, {
  useEffect,
  useLayoutEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  Check as CheckIcon,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  LoaderCircle,
  ShieldCheck,
  ShieldHalf,
  ShieldAlert,
} from "lucide-react";
export { api } from "../api.js";
/** 圆环内的实心方块表达停止操作，避免与空心复选框混淆。 */
export function StopIcon() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      focusable="false"
    >
      <circle cx="12" cy="12" r="9" />
      <rect
        x="8"
        y="8"
        width="8"
        height="8"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
/** 公共按钮按操作层级渲染；纯图标沿用文字作为提示和可访问名称。 */
export function Button({
  children,
  primary = false,
  icon,
  ...rest
}: React.ComponentProps<"button"> & {
  primary?: boolean;
  icon?: ReactNode;
}) {
  useLocale();
  const [pending, setPending] = useState(false);
  return (
    <button
      {...rest}
      title={
        rest.title ||
        (icon && typeof children === "string" ? children.trim() : undefined)
      }
      aria-label={
        rest["aria-label"] ||
        (icon && typeof children === "string" ? children.trim() : undefined)
      }
      disabled={rest.disabled || pending}
      aria-busy={rest["aria-busy"] || pending || undefined}
      onClick={(event) => {
        const result: any = rest.onClick?.(event);
        if (result && typeof result.finally === "function") {
          setPending(true);
          void result.finally(() => setPending(false));
        }
      }}
      className={
        "btn " +
        (primary ? "primary " : "") +
        (icon ? "icon-button " : "") +
        (rest.className || "")
      }
    >
      {pending && <LoaderCircle className="spin" aria-hidden="true" />}
      {pending && (icon || rest.className?.split(" ").includes("icon-button"))
        ? null
        : icon || children}
    </button>
  );
}
type SelectOption = {
  value: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** 禁用项保持可聚焦并可读取原因，但不会提交。 */
  disabled?: boolean;
  children?: SelectOption[];
};

/** 原生语义按钮配合自定义列表；支持方向键、首尾定位、Escape 和焦点返回。 */
export function Select({
  id,
  "aria-describedby": describedBy,
  "aria-invalid": invalid,
  value,
  onChange,
  options,
  label,
  disabled = false,
  iconOnly = false,
  selectedLabel,
  trigger,
  openSignal = 0,
  closeSignal = "",
  searchable = false,
  variant = "outlined",
}: {
  value: string;
  onChange: (v: string) => void;
  options: SelectOption[];
  label: string;
  disabled?: boolean;
  iconOnly?: boolean;
  /** 收起时可使用简短名称，列表与提示保留完整选项标签。 */
  selectedLabel?: string;
  trigger?: ReactNode;
  openSignal?: number;
  closeSignal?: string;
  searchable?: boolean;
  /** 工具栏和语言入口使用无边框变体，保留完整焦点与展开反馈。 */
  variant?: "outlined" | "ghost";
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: React.AriaAttributes["aria-invalid"];
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  // 展开父项只改变菜单层级，提交始终使用最终选项。
  const [trail, setTrail] = useState<string[]>([]);
  const roots = options.filter(
    (option) => !searchable || option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
  );
  let shown = roots;
  const levels = [roots];
  for (const value of trail) {
    const children = shown.find((option) => option.value === value)?.children;
    if (!children) break;
    shown = children;
    levels.push(shown);
  }
  const depth = levels.length - 1;
  // 父级布局收起时同步关闭 portal，避免留下脱离触发按钮的列表。
  useEffect(() => {
    setOpen(false);
  }, [closeSignal]);
  useEffect(() => {
    if (openSignal) {
      setIndex(0);
      setOpen(true);
    }
  }, [openSignal]);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [index, setIndex] = useState(0);
  const popup = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [position, setPosition] = useState<React.CSSProperties | null>(null);
  // 固定定位并向上翻转，避免输入区、侧栏和弹窗滚动容器裁切选项。
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const place = () => {
      const rect = button.current!.getBoundingClientRect();
      const viewport = window.visualViewport;
      const viewportTop = viewport?.offsetTop || 0;
      const viewportLeft = viewport?.offsetLeft || 0;
      const viewportWidth = viewport?.width || innerWidth;
      const viewportBottom = viewportTop + (viewport?.height || innerHeight);
      const height = Math.min(
        240,
        (shown.length + (depth ? 1 : 0)) * 42 + 12 + (searchable ? 54 : 0),
      );
      const width = Math.min(
        viewportWidth - 16,
        Math.max(rect.width, trigger ? 220 : 200),
      );
      const above =
        viewportBottom - rect.bottom < height &&
        rect.top - viewportTop > viewportBottom - rect.bottom;
      setPosition({
        position: "fixed",
        left: Math.max(
          viewportLeft + 8,
          Math.min(rect.left, viewportLeft + viewportWidth - width - 8),
        ),
        width,
        minWidth: 0,
        maxWidth: "calc(100vw - 16px)",
        top: Math.max(
          viewportTop + 8,
          Math.min(
            above ? rect.top - height - 5 : rect.bottom + 5,
            viewportBottom -
              Math.min(height, viewportBottom - viewportTop - 16) -
              8,
          ),
        ),
        maxHeight: Math.max(
          80,
          Math.min(240, viewportBottom - viewportTop - 16),
        ),
      });
    };
    place();
    addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    window.visualViewport?.addEventListener("scroll", place);
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) place();
    };
    addEventListener("scroll", scroll, true);
    return () => {
      removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("resize", place);
      window.visualViewport?.removeEventListener("scroll", place);
      removeEventListener("scroll", scroll, true);
    };
  }, [open, shown.length, searchable, depth]);
  useEffect(() => {
    const outside = (e: PointerEvent) => {
      if (
        !root.current?.contains(e.target as Node) &&
        !popup.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  // 定位完成后再挂载并聚焦列表，避免浏览器把弹窗滚到尚未定位的选项。
  const positioned = open && position !== null;
  useEffect(() => {
    if (positioned && !(searchable && index === -1))
      popup.current
        ?.querySelectorAll<HTMLButtonElement>("[role=option]")
        [index]?.focus();
  }, [positioned, index, depth]);
  useEffect(() => {
    if (!open) setTrail([]);
  }, [open]);
  function back() {
    setIndex(levels[depth - 1].findIndex((option) => option.value === trail[depth - 1]));
    setTrail(trail.slice(0, depth - 1));
  }
  function key(e: React.KeyboardEvent) {
    if (depth && ["Escape", "ArrowLeft"].includes(e.key)) {
      e.preventDefault();
      e.stopPropagation();
      back();
      return;
    }
    if (open && e.key === "ArrowRight" && shown[index]?.children) {
      e.preventDefault();
      setTrail([...trail.slice(0, depth), shown[index].value]);
      setIndex(0);
      return;
    }
    if (e.key === "Escape" && !open) return;
    if (e.key === "Tab" && open) {
      setOpen(false);
      button.current?.focus();
    }
    if (e.key === "Escape" && open) e.stopPropagation();
    if (
      searchable &&
      (e.target as HTMLElement).tagName === "INPUT" &&
      !["ArrowDown", "ArrowUp", "Escape"].includes(e.key)
    )
      return;
    if (!shown.length || disabled) {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End", "Escape"].includes(e.key)) {
      e.preventDefault();
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      } else {
        setOpen(true);
        setIndex(
          e.key === "Home"
            ? 0
            : e.key === "End"
              ? shown.length - 1
              : (index + (e.key === "ArrowDown" ? 1 : -1) + shown.length) %
                shown.length,
        );
      }
    }
  }
  return (
    <div
      className={
        `select ui-select ui-select-${variant}` +
        (iconOnly ? " select-icon" : "") +
        (trigger && iconOnly ? " icon-select" : "")
      }
      ref={root}
      onKeyDown={(event) => {
        if (!popup.current?.contains(event.target as Node)) key(event);
      }}
    >
      <button
        id={id}
        ref={button}
        type="button"
        className={
          "select-trigger" +
          (trigger && iconOnly ? " icon-button" : "") +
          (options.find((o) => o.value === value)?.danger
            ? " permission-danger"
            : "")
        }
        title={options.find((o) => o.value === value)?.label}
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={describedBy}
        aria-invalid={invalid}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => {
          setSearch("");
          setIndex(
            searchable
              ? -1
              : Math.max(
                  0,
                  options.findIndex((o) => o.value === value),
                ),
          );
          setOpen(!open);
        }}
      >
        {trigger ||
          (iconOnly ? (
            options.find((o) => o.value === value)?.icon
          ) : (
            <span>
              {selectedLabel ||
                options.find((o) => o.value === value)?.label ||
                tr("web.chooseAnOption")}
            </span>
          ))}
        {!trigger && !iconOnly && <ChevronDown size={15} aria-hidden="true" />}
      </button>
      {positioned &&
        createPortal(
          <div
            ref={popup}
            id={listId}
            style={position}
            className={
              "select-options" + (searchable ? " ui-search-options" : "")
            }
            role="listbox"
            aria-label={label}
            onKeyDown={key}
          >
            {depth > 0 && (
              <button type="button" onClick={back}>
                <ChevronLeft size={15} aria-hidden="true" />
                {tr(depth === 1 ? "web.agentPicker.back" : "web.agentPicker.backToCli")}
              </button>
            )}
            {searchable && (
              <input
                autoFocus
                aria-label={tr("ui.searchOptions")}
                placeholder={tr("ui.searchOptions")}
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setIndex(-1);
                }}
              />
            )}
            {searchable && !shown.length && (
              <p role="status">{tr("ui.noOptions")}</p>
            )}
            {shown.map((o, i) => (
              <button
                key={o.value}
                type="button"
                className={o.danger ? "permission-danger" : undefined}
                role="option"
                aria-selected={value === o.value}
                aria-disabled={o.disabled || undefined}
                tabIndex={i === index ? 0 : -1}
                onClick={() => {
                  if (o.disabled) return;
                  if (o.children?.length) {
                    setTrail([...trail.slice(0, depth), o.value]);
                    setIndex(0);
                    return;
                  }
                  onChange(o.value);
                  setOpen(false);
                  button.current?.focus();
                }}
              >
                {o.icon}
                {o.label}
                {!depth && o.children?.length ? (
                  <ChevronRight size={15} aria-hidden="true" />
                ) : null}
              </button>
            ))}
          </div>,
          root.current?.closest("dialog") || document.body,
        )}
    </div>
  );
}
export function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  useLocale();
  const id = useId();
  const nodes = React.Children.toArray(children);
  const control = nodes.find(
    (node) => React.isValidElement(node) && typeof node.type === "function",
  );
  return (
    <div
      className="field ui-field"
      role={control ? undefined : "group"}
      aria-labelledby={control ? undefined : id}
    >
      {control ? (
        <label htmlFor={id}>{label}</label>
      ) : (
        <span id={id}>{label}</span>
      )}
      {nodes.map((node) =>
        node === control
          ? React.cloneElement(node as React.ReactElement<{ id?: string }>, {
              id,
            })
          : node,
      )}
    </div>
  );
}

export function Check({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  useLocale();
  return (
    <label className="check">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="check-mark" aria-hidden="true">
        <CheckIcon size={14} strokeWidth={3} />
      </span>
      {children}
    </label>
  );
}
/** 原生 dialog 提供焦点约束与 Escape，外观和所有确认按钮由统一组件控制。 */
export function Modal({
  title,
  children,
  onClose,
  busy = false,
  layout = "default",
  closeOnBackdrop = false,
  trapFocus = true,
  closeLabel = tr("web.close"),
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  busy?: boolean;
  layout?: "default" | "viewer";
  closeOnBackdrop?: boolean;
  trapFocus?: boolean;
  closeLabel?: string;
}) {
  useLocale();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!closing || busy) return;
    const timer = setTimeout(
      onClose,
      matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 150,
    );
    return () => clearTimeout(timer);
  }, [closing, onClose, busy]);
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    // 先记录触发入口，再聚焦指定输入，确保关闭后能正确返回入口。
    dialog?.querySelector<HTMLElement>("[data-initial-focus]")?.focus();
    return () => {
      dialog?.close();
      if (trigger?.isConnected) trigger.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-layout={layout === "viewer" ? layout : undefined}
      className={closing ? "closing" : ""}
      onKeyDown={(e) => {
        if (!trapFocus || e.key !== "Tab") return;
        // 原生 dialog 允许 Tab 进入浏览器工具栏；标题编辑显式循环焦点。
        const controls = Array.from(
          e.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
          ),
        ).filter((element) => element.getClientRects().length > 0);
        const first = controls[0],
          last = controls.at(-1);
        if (!first) {
          e.preventDefault();
          return;
        }
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }}
      onCancel={(e) => {
        // 嵌套文件预览只关闭顶层弹窗，避免 Escape 同时关闭工作项。
        e.stopPropagation();
        e.preventDefault();
        if (!busy) setClosing(true);
      }}
      onClick={(e) => {
        if (busy || !closeOnBackdrop || e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          setClosing(true);
      }}
    >
      <header>
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="btn ui-button ui-button-ghost ui-icon"
          aria-label={closeLabel}
          disabled={busy}
          onClick={() => setClosing(true)}
        >
          <X />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function ErrorBox({ error }: { error: unknown }) {
  useLocale();
  return error ? (
    <div role="alert" className="error-box ui-alert ui-alert-error">
      {displayError(error)}
    </div>
  ) : null;
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  useLocale();
  return (
    <div className="empty">
      <img src="/assets/bugpaw-mascot.png" alt="" />
      <h2>{title}</h2>
      <div className="empty-description">{children}</div>
    </div>
  );
}
export const statusNames: Record<string, string> = {
  get idle() {
    return tr("web.ready");
  },
  get human() {
    return tr("web.awaitingManualAdvancement");
  },
  get queued() {
    return tr("web.waitingForEnvironmentQueued");
  },
  get dispatching() {
    return tr("web.dispatching");
  },
  get running() {
    return tr("web.running");
  },
  get waiting() {
    return tr("web.awaitingNativeInteraction");
  },
  get approval() {
    return tr("web.awaitingPlatformApproval");
  },
  get unknown() {
    return tr("web.statusUnconfirmed");
  },
  get stopping() {
    return tr("web.stopping");
  },
  get completed() {
    return tr("web.executionFinished");
  },
  get cancelled() {
    return tr("web.cancelled");
  },
  get failed() {
    return tr("web.executionFailed");
  },
  get done() {
    return tr("web.done");
  },
  get interrupted() {
    return tr("web.interrupted");
  },
  get resuming() {
    return tr("web.resuming");
  },
};
export function Status({ value }: { value: string }) {
  useLocale();
  return (
    <span className={"tag ui-badge status-" + value}>
      {statusNames[value] || value}
    </span>
  );
}
export function Busy() {
  useLocale();
  return (
    <LoaderCircle
      className="spin"
      aria-label={tr("web.processingAlternative50")}
    />
  );
}
/** 三种权限模式；完全权限在目标 Claude 以 root 运行时禁用，仍保持可见。 */
export function permissionOptions(restricted = false) {
  return [
    { value: "ask", label: tr("web.ask") },
    { value: "auto", label: tr("web.autoApprove") },
    {
      value: "full",
      label: tr("web.fullAccess"),
      danger: true,
      disabled: restricted,
    },
  ];
}
export const permissions = permissionOptions();
/** 权限值的展示名；未知值按询问模式显示。 */
export function permissionLabel(value?: string) {
  return value === "full"
    ? tr("web.fullAccess")
    : value === "auto"
      ? tr("web.autoApprove")
      : tr("web.ask");
}
export const runtimes = [
  { value: "codex", label: "Codex" },
  { value: "claude", label: "Claude Code" },
];

/** 两处输入区共用权限图标与红色完全权限提示，保留列表键盘操作。 */
export function PermissionSelect({
  restricted = false,
  auto = true,
  ...props
}: Omit<React.ComponentProps<typeof Select>, "options" | "iconOnly"> & {
  restricted?: boolean;
  /** 工作台助手自身权限仍只有询问与完全权限，需关闭自动审批项。 */
  auto?: boolean;
}) {
  useLocale();
  return (
    <Select
      {...props}
      iconOnly
      options={[
        {
          value: "ask",
          label: tr("web.ask"),
          icon: <ShieldCheck size={18} aria-hidden="true" />,
        },
        ...(auto
          ? [
              {
                value: "auto",
                label: tr("web.autoApprove"),
                icon: <ShieldHalf size={18} aria-hidden="true" />,
              },
            ]
          : []),
        {
          value: "full",
          label: tr("web.fullAccess"),
          icon: <ShieldAlert size={18} aria-hidden="true" />,
          danger: true,
          disabled: restricted,
        },
      ]}
    />
  );
}

/** Enter 发送；组合键显式换行，避免输入法选词或长按造成误发送。 */
export function composerKeyDown(
  event: React.KeyboardEvent<HTMLTextAreaElement>,
  send: () => void,
  change: (value: string) => void,
  caret: (position: number) => void,
) {
  if (
    event.key !== "Enter" ||
    event.nativeEvent.isComposing ||
    event.keyCode === 229
  )
    return;
  event.preventDefault();
  if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) {
    const node = event.currentTarget;
    caret(node.selectionStart + 1);
    change(
      node.value.slice(0, node.selectionStart) +
        "\n" +
        node.value.slice(node.selectionEnd),
    );
  } else if (!event.repeat) send();
}

/** 两类会话共享侧栏；手机抽屉保留对话背景，并约束焦点与滚动。 */
export function SessionSidebar({
  open,
  onClose,
  children,
  label,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  label: string;
}) {
  useLocale();
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [mobile, setMobile] = useState(
    () => matchMedia("(max-width: 759px)").matches,
  );
  useEffect(() => {
    const media = matchMedia("(max-width: 759px)");
    const change = () => setMobile(media.matches);
    media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const trigger = document.activeElement as HTMLElement | null;
    const sidebar = ref.current!;
    const chat = sidebar.parentElement?.querySelector<HTMLElement>(".chat");
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (chat) chat.inert = true;
    sidebar.querySelector<HTMLButtonElement>(".session-sidebar-close")?.focus();
    const key = (event: KeyboardEvent) => {
      // 下拉列表和顶层确认框先处理自己的键盘操作，不能顺带关闭抽屉。
      if (document.querySelector("dialog[open], .select-options")) return;
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const nodes = [
          ...sidebar.querySelectorAll<HTMLElement>(
            "button:not(:disabled), input:not(:disabled), a[href], [tabindex='0'], summary",
          ),
        ].filter((node) => node.getClientRects().length);
        const first = nodes[0],
          last = nodes.at(-1);
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !sidebar.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !sidebar.contains(document.activeElement))
        ) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = overflow;
      if (chat) chat.inert = false;
      if (
        trigger?.isConnected &&
        trigger !== document.body &&
        !sidebar.contains(trigger)
      )
        trigger.focus();
      else
        sidebar.parentElement
          ?.querySelector<HTMLButtonElement>(".phone-list")
          ?.focus();
    };
  }, [open, mobile]);
  return (
    <>
      {open && mobile && (
        <button
          className="session-scrim"
          aria-label={tr("web.closeSessionListOverlay")}
          tabIndex={-1}
          onClick={onClose}
        />
      )}
      <aside
        ref={ref}
        className="session-list"
        role={mobile && open ? "dialog" : undefined}
        aria-label={label}
        aria-modal={mobile && open ? true : undefined}
        inert={mobile && !open ? true : undefined}
      >
        <header className="session-sidebar-header">
          <strong>{label}</strong>
          <button
            type="button"
            className="btn ui-button ui-button-ghost ui-icon icon-button session-sidebar-close"
            aria-label={tr("web.closeSessionList")}
            title={tr("web.closeSessionList")}
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </button>
        </header>
        {children}
      </aside>
    </>
  );
}
