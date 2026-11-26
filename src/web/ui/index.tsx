import React, {
  useId,
  useRef,
  useState,
  useLayoutEffect,
  useEffect,
  type ReactNode,
} from "react";
import { Search, ChevronDown, CircleAlert, Copy } from "lucide-react";
import type { Components, ExtraProps } from "react-markdown";
import {
  Button as BaseButton,
  Select as BaseSelect,
  Modal as BaseModal,
  Check as BaseCheck,
} from "./primitives.js";
import { t, useLocale } from "../locale.js";

/** 正式按钮只允许语义变体与尺寸；提交必须显式声明 type。 */
export function Button({
  variant = "secondary",
  size = "normal",
  shape = "text",
  placement,
  icon,
  mark,
  ...props
}: Omit<
  React.ComponentProps<typeof BaseButton>,
  "primary" | "className" | "style" | "icon"
> & {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "attention";
  size?: "normal" | "small";
  shape?: "text" | "icon";
  icon?: ReactNode;
  mark?: string;
  placement?:
    | "sidebar-toggle"
    | "jump-bottom"
    | "attachment-add"
    | "attachment-action"
    | "runtime-refresh"
    | "theme-cycle"
    | "logout"
    | "mobile-menu";
}) {
  return (
    <BaseButton
      {...props}
      type={props.type || "button"}
      primary={variant === "primary"}
      aria-label={
        props["aria-label"] ||
        (icon && typeof props.children === "string"
          ? props.children
          : undefined)
      }
      title={
        props.title ||
        (icon && typeof props.children === "string"
          ? props.children
          : undefined)
      }
      icon={
        icon ? (
          <>
            {icon}
            {mark && (
              <span className="ui-mark" aria-hidden="true">
                {mark}
              </span>
            )}
          </>
        ) : undefined
      }
      className={`ui-button ui-button-${variant} ui-button-${size}${shape === "icon" || icon ? " ui-icon icon-button" : ""}${placement ? " " + { "sidebar-toggle": "phone-list", "jump-bottom": "jump-bottom", "attachment-add": "attachment-add", "attachment-action": "attachment-action", "runtime-refresh": "runtime-refresh", "theme-cycle": "theme-cycle", logout: "profile-logout", "mobile-menu": "mobile-menu" }[placement] : ""}`}
    >
      {props.children}
      {!icon && mark && (
        <span className="ui-mark" aria-hidden="true">
          {mark}
        </span>
      )}
    </BaseButton>
  );
}
/** 图标提示共用可访问名称，移动端点击直接操作；状态角标不能仅依赖颜色。 */
export function IconButton({
  label,
  icon,
  mark,
  danger = false,
  variant = "ghost",
  ...props
}: Omit<React.ComponentProps<typeof Button>, "children" | "size"> & {
  label: string;
  icon: ReactNode;
  mark?: string;
  danger?: boolean;
}) {
  return (
    <span className="ui-icon-wrap" data-tip={label}>
      <BaseButton
        {...props}
        type={props.type || "button"}
        primary={variant === "primary"}
        className={`ui-button ui-icon ui-button-${danger ? "danger" : variant}`}
        aria-label={label}
        icon={
          <>
            {icon}
            {mark && (
              <span className="ui-mark" aria-hidden="true">
                {mark}
              </span>
            )}
          </>
        }
      />
    </span>
  );
}
/** Markdown 解析器提供的代码原文不包含围栏，保留缩进和末尾换行。 */
export function markdownCodeContent(node: ExtraProps["node"]) {
  const code = node?.children[0];
  const classes =
    code?.type === "element" ? code.properties.className : undefined;
  const language = Array.isArray(classes)
    ? classes.find(
        (name) => typeof name === "string" && name.startsWith("language-"),
      )
    : undefined;

  const text = code?.type === "element" && code.children[0];
  return {
    language: typeof language === "string" ? language.slice("language-".length) : "",
    source: text && text.type === "text" ? text.value : "",
  };
}

/** 代码块共用语言与复制栏；视觉折行不进入剪贴板。 */
export const MarkdownCodeBlock: NonNullable<Components["pre"]> = ({ children, node }) => {
  return <CodeBlockFrame {...markdownCodeContent(node)}>
    <pre>{children}</pre>
  </CodeBlockFrame>;
};

/** 工具栏与复制反馈独立于代码正文的展示形式。 */
export function CodeBlockFrame({ children, source, language }: {
  children: ReactNode; source: string; language: string;
}) {
  useLocale();
  const [result, setResult] = useState<"copied" | "failed">();

  async function copy() {
    try {
      await navigator.clipboard.writeText(source);
      setResult("copied");
    } catch {
      setResult("failed");
    }
  }

  return (
    <div className="markdown-code-block">
      <div className="markdown-code-toolbar">
        <span>
          {language || t("web.plainTextCode")}
        </span>
        <Button
          variant="ghost"
          shape="icon"
          aria-label={t("web.copyCode")}
          title={t("web.copyCode")}
          onClick={copy}
        >
          <Copy aria-hidden="true" />
        </Button>
      </div>
      {children}
      <div className="markdown-code-feedback" role="status">
        {result &&
          t(result === "copied" ? "web.codeCopied" : "web.codeCopyFailed")}
      </div>
    </div>
  );
}
/** 标准字段关联帮助与错误；多控件分组应另用 fieldset，不能嵌套 label。 */
export function FormField({
  label,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children: React.ReactElement<{
    id?: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
    required?: boolean;
  }>;
}) {
  const id = useId(),
    controlId = children.props.id || id;
  return (
    <div className="ui-field">
      <label htmlFor={controlId}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      {React.cloneElement(children, {
        id: controlId,
        required,
        "aria-invalid": !!error,
        "aria-describedby": error || hint ? id + "-help" : undefined,
      })}
      {(error || hint) && (
        <small
          id={id + "-help"}
          className={error ? "ui-field-error" : undefined}
          role={error ? "alert" : undefined}
        >
          {error || hint}
        </small>
      )}
    </div>
  );
}
/** 文本输入宽度由容器控制，禁止用数据长度改变布局。 */
export function Input({
  variant,
  ...props
}: Omit<React.ComponentProps<"input">, "className" | "style"> & {
  variant?: "search";
}) {
  return (
    <input
      {...props}
      className={`ui-input${variant === "search" ? " search-input" : ""}`}
    />
  );
}
/** 正文输入允许调整高度，不允许撑宽页面。 */
export function Textarea({
  variant = "field",
  ...props
}: Omit<React.ComponentProps<"textarea">, "className" | "style"> & {
  variant?: "field" | "code" | "composer";
}) {
  return (
    <textarea
      {...props}
      className={`ui-input ui-textarea${variant === "code" ? " mono" : variant === "composer" ? " ui-composer-input" : ""}`}
    />
  );
}
/** 搜索保留名称，图标仅辅助识别。 */
export function SearchInput(props: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="ui-search">
      <Search aria-hidden="true" />
      <Input
        aria-label={props.label}
        placeholder={props.label}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}
/** 选择器复用已验证的键盘、portal 与视口定位，统一外观由组件层提供。 */
export function Select(props: React.ComponentProps<typeof BaseSelect>) {
  return <BaseSelect {...props} />;
}
/** 复选框沿用原生语义，自定义外观与触控区域。 */
export function Checkbox(props: React.ComponentProps<typeof BaseCheck>) {
  return (
    <div className="ui-check">
      <BaseCheck {...props} />
    </div>
  );
}
/** 状态始终包含文字，不单靠颜色区分。 */
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "warning" | "danger";
}) {
  return (
    <span className={`tag ui-badge ui-badge-${tone}`}>
      {tone !== "neutral" && <span aria-hidden="true">●</span>}
      {children}
    </span>
  );
}
/** 页面布局控制内容最大宽度及页边距。 */
export function Page({ children }: { children: ReactNode }) {
  return <div className="page ui-page">{children}</div>;
}
/** 标题正文可换行，操作区不参与标题挤压。 */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="ui-page-header">
      <div>
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-actions">{actions}</div>}
    </header>
  );
}
/** 集合页统一管理标题、筛选和结果间距。 */
export function CollectionLayout({
  title,
  description,
  actions,
  toolbar,
  summary,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  summary?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Page>
      <PageHeader title={title} description={description} actions={actions} />
      {summary && <div className="ui-summary">{summary}</div>}
      {toolbar && <div className="ui-toolbar">{toolbar}</div>}
      {children}
    </Page>
  );
}
/** 集合容器按可用宽度切换列数，允许窄侧栏复用。 */
export function CardGrid({ children }: { children: ReactNode }) {
  return <div className="ui-card-grid">{children}</div>;
}
/** 对象卡标题最多两行；详情入口由业务提供完整原文。 */
export function EntityCard({
  title,
  subtitle,
  icon,
  status,
  children,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  status?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <section className="ui-entity-card">
      <div className="ui-card-top">
        <span className="ui-object-icon">{icon}</span>
        {status}
      </div>
      <h2 className="ui-clamp-two">{title}</h2>
      {subtitle && <p className="ui-card-subtitle">{subtitle}</p>}
      <div className="ui-card-body">{children}</div>
      {actions && <footer className="ui-actions">{actions}</footer>}
    </section>
  );
}
/** 元数据允许长路径断行，标签与值都不能撑宽容器。 */
export function Metadata({
  items,
}: {
  items: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="ui-metadata">
      {items.map(({ label, value }, i) => (
        <div key={i}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
/** 表单或详情按标题分组，不为每个字段创建独立卡片。 */
export function Panel({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <section className="ui-panel">
      {title && <h2>{title}</h2>}
      {children}
    </section>
  );
}
/** 使用独立动作区，长内容不推挤关键操作。 */
export function Actions({ children }: { children: ReactNode }) {
  return <div className="ui-actions">{children}</div>;
}
/** 页内分类沿用按钮组语义，Tab 导航不伪装成选择器。 */
export function Sections({
  label,
  value,
  onChange,
  items,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: { value: string; label: string }[];
}) {
  return (
    <div className="ui-sections" role="group" aria-label={label}>
      {items.map((item) => (
        <Button
          key={item.value}
          variant={value === item.value ? "primary" : "ghost"}
          aria-pressed={value === item.value}
          onClick={() => onChange(item.value)}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}
/** 空状态由业务明确提供下一步，不将筛选零结果误报为首次使用。 */
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <section className="ui-empty">
      <Search aria-hidden="true" />
      <h2>{title}</h2>
      {description && <p>{description}</p>}
      {action}
    </section>
  );
}
/** 阻断反馈保持可见，错误正文不按行截断。 */
export function Alert({
  title,
  children,
  error = false,
}: {
  title: string;
  children?: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      className={`ui-alert ${error ? "ui-alert-error" : ""}`}
      role={error ? "alert" : "status"}
    >
      <CircleAlert aria-hidden="true" />
      <div>
        <strong>{title}</strong>
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}
/** 弹窗复用原有焦点约束和返回逻辑，表单默认不因点击遮罩关闭。 */
export function Dialog({
  children,
  ...props
}: React.ComponentProps<typeof BaseModal>) {
  return (
    <BaseModal
      {...props}
      closeOnBackdrop={props.closeOnBackdrop ?? false}
      trapFocus
    >
      <div className="ui-dialog-content">{children}</div>
    </BaseModal>
  );
}
/** 通过原生 details 提供手机也能操作的全文入口。 */
export function Disclosure({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <details className="ui-disclosure">
      <summary>
        {label}
        <ChevronDown aria-hidden="true" />
      </summary>
      <div>{children}</div>
    </details>
  );
}
/** 信息浮窗与动作菜单共用定位，滚动或缩放时保持在视口内。 */
function useAnchoredPopover(
  open: boolean,
  root: React.RefObject<HTMLSpanElement | null>,
  panel: React.RefObject<HTMLDivElement | null>,
) {
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const trigger = root.current?.querySelector("button"),
        popup = panel.current;
      if (!trigger || !popup) return;
      const rect = trigger.getBoundingClientRect(),
        viewport = window.visualViewport;
      const top = viewport?.offsetTop || 0,
        left = viewport?.offsetLeft || 0;
      const width = viewport?.width || innerWidth,
        height = viewport?.height || innerHeight;
      popup.style.maxHeight = Math.max(0, height - 24) + "px";
      const box = popup.getBoundingClientRect();
      popup.style.left =
        Math.max(
          left + 12,
          Math.min(rect.left, left + width - box.width - 12),
        ) + "px";
      popup.style.top =
        Math.max(
          top + 12,
          Math.min(rect.bottom + 6, top + height - box.height - 12),
        ) + "px";
    };
    place();
    addEventListener("resize", place);
    window.visualViewport?.addEventListener("resize", place);
    const scroll = (event: Event) => {
      if (event.target instanceof Node && panel.current?.contains(event.target))
        return;
      place();
    };
    addEventListener("scroll", scroll, true);
    return () => {
      removeEventListener("resize", place);
      removeEventListener("scroll", scroll, true);
      window.visualViewport?.removeEventListener("resize", place);
    };
  }, [open, root, panel]);
}

/** 原生浮窗提供外部点击、Escape 关闭和键盘焦点恢复。 */
export function InfoBadge({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useAnchoredPopover(open, root, panel);
  return (
    <span ref={root}>
      <button
        type="button"
        popoverTarget={id}
        className="ui-badge ui-badge-warning ui-info-trigger"
      >
        {label}
        <CircleAlert size={13} aria-hidden="true" />
      </button>
      <div
        id={id}
        ref={panel}
        popover="auto"
        role="note"
        aria-label={label}
        className="ui-menu-popup ui-info-popup"
        onToggle={(event) => setOpen(event.newState === "open")}
      >
        {children}
      </div>
    </span>
  );
}

/** 可搜索列表与菜单必须分开；菜单使用原生 popover 管关闭和焦点返回。 */
export function ActionMenu({
  label,
  icon,
  items,
  openSignal = 0,
}: {
  openSignal?: number;
  label: string;
  icon: ReactNode;
  items: {
    label: string;
    danger?: boolean;
    disabled?: boolean;
    onSelect: () => void;
  }[];
}) {
  const id = useId();
  const root = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  useLocale();
  useEffect(() => {
    if (!openSignal) return;
    menu.current?.showPopover();
    menu.current
      ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
      ?.focus();
  }, [openSignal]);
  useAnchoredPopover(open, root, menu);
  return (
    <span className="ui-menu" ref={root}>
      <IconButton
        label={label}
        icon={icon}
        aria-controls={id}
        onClick={() => {
          const popup = menu.current;
          if (!popup) return;
          popup.togglePopover();
          if (popup.matches(":popover-open"))
            popup
              .querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            menu.current?.showPopover();
            menu.current
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
          }
        }}
      />
      <div
        id={id}
        ref={menu}
        onToggle={(event) => {
          const isOpen = event.newState === "open";
          setOpen(isOpen);

          // 关闭后保留用户的新焦点，避免抢走菜单动作打开的弹窗焦点。
        }}
        popover="auto"
        className="ui-menu-popup"
        role="menu"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            menu.current?.hidePopover();
            root.current
              ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
              ?.focus();
            return;
          }
          const buttons = Array.from(
            e.currentTarget.querySelectorAll<HTMLButtonElement>(
              "button:not(:disabled)",
            ),
          );
          const current = buttons.indexOf(
            document.activeElement as HTMLButtonElement,
          );
          if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
            e.preventDefault();
            buttons[
              e.key === "Home"
                ? 0
                : e.key === "End"
                  ? buttons.length - 1
                  : (current +
                      (e.key === "ArrowUp" ? -1 : 1) +
                      buttons.length) %
                    buttons.length
            ]?.focus();
          }
        }}
      >
        {items.map((item, i) => (
          <button
            type="button"
            role="menuitem"
            disabled={item.disabled}
            key={i}
            className={item.danger ? "ui-menu-danger" : undefined}
            onClick={(e) => {
              e.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover();
              root.current
                ?.querySelector<HTMLButtonElement>("button:not(:disabled)")
                ?.focus();
              item.onSelect();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
    </span>
  );
}
/** 思考、权限等共用图标选择器；保留当前值的辅助名称与风险角标。 */
export function IconSelect({
  label,
  value,
  options,
  onChange,
  icon,
  mark,
  danger = false,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  icon: ReactNode;
  mark?: string;
  danger?: boolean;
}) {
  const name = `${label}: ${options.find((o) => o.value === value)?.label || value}`;
  return (
    <span
      className={`ui-icon-select ${danger ? "ui-risk" : ""}`}
      data-tip={name}
    >
      <Select
        iconOnly
        label={name}
        value={value}
        options={options}
        onChange={onChange}
        trigger={
          <>
            {icon}
            {mark && (
              <span className="ui-mark" aria-hidden="true">
                {mark}
              </span>
            )}
          </>
        }
      />
    </span>
  );
}

/** 正式入口统一导出交互基础、状态语义与响应式会话布局。 */
export {
  Field,
  ErrorBox,
  Empty,
  Status,
  Busy,
  StopIcon,
  PermissionSelect,
  SessionSidebar,
  statusNames,
  permissions,
  permissionOptions,
  permissionLabel,
  runtimes,
  composerKeyDown,
} from "./primitives.js";
export { Dialog as Modal, Checkbox as Check };
export { api } from "../api.js";

export * from "./controls.js";
export * from "./layouts.js";
export { CliBrandIcon } from "./cli-brand-icon.js";
export { ResponsiveList, TrafficChart, Utilization, byteAmount } from "./monitoring.js";
