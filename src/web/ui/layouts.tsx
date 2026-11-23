import type {
  ComponentProps,
  CSSProperties,
  KeyboardEvent,
  ReactNode,
} from "react";

/** 页面组合只传结构与状态，禁止传入任意视觉样式。 */
type BoxProps = Omit<ComponentProps<"div">, "className" | "style">;
/** 公共操作行允许换行，长内容保持在父容器内。 */
export function Row(props: BoxProps) {
  return <div {...props} className="row ui-row" />;
}
/** 表单双列按窄屏自动收为单列。 */
export function FormGrid(props: BoxProps) {
  return <div {...props} className="form-grid ui-form-grid" />;
}
/** 筛选操作区统一布局。 */
export function Toolbar(props: BoxProps) {
  return <div {...props} className="toolbar ui-toolbar" />;
}
/** 组合式页面标题，用于标题中包含编辑或返回控件的情况。 */
export function PageHeading(props: BoxProps) {
  return <div {...props} className="pagehead ui-page-header" />;
}
/** 设置正文区域的标题、表单和反馈共用间距。 */
export function SettingsPanel({
  model = false,
  ...props
}: BoxProps & { model?: boolean }) {
  return (
    <section
      {...props}
      className={`settings-panel ui-settings-panel${model ? " model-row" : ""}`}
    />
  );
}
/** 页内分类保留既有导航语义与键盘顺序。 */
export function Tabs(props: BoxProps) {
  return <div {...props} className="tabs ui-tabs" />;
}
/** 设置目录与正文共用响应式分栏。 */
export function SettingsLayout(props: BoxProps) {
  return (
    <div
      {...props}
      className="setting-layout wb-setting-layout ui-settings-layout"
    />
  );
}
/** 两类 Agent 会话共用整体布局和抽屉开关状态。 */
export function WorkspaceLayout({
  kind,
  open,
  ...props
}: BoxProps & { kind: "workbench" | "conversations"; open: boolean }) {
  return (
    <div
      {...props}
      className={`split ${kind}-layout${open ? " show-list" : ""}`}
    />
  );
}
/** 会话正文保持内部滚动，不让输入区离开视口。 */
export function ConversationPane(props: BoxProps) {
  return <section {...props} className="chat" />;
}
/** 输入区统一外壳，上传事件和业务状态由页面传入。 */
export function Composer(props: BoxProps) {
  return <div {...props} className="composer unified-composer" />;
}
/** 看板列数是数据布局参数，不允许页面注入其他内联样式。 */
export function BoardLayout({
  columns,
  ...props
}: BoxProps & { columns: number }) {
  return (
    <div
      {...props}
      className="board"
      style={{
        gridTemplateColumns: `repeat(${Math.max(1, columns)},minmax(240px,1fr))`,
      }}
    />
  );
}
/** 拖拽浮层只接收指针坐标，边界裁切由组件统一处理。 */
export function DragPreview({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: ReactNode;
}) {
  return (
    <div
      className="drag-ghost"
      role="status"
      style={{
        left: Math.min(x + 12, innerWidth - 210),
        top: Math.max(8, y - 48),
      }}
    >
      {children}
    </div>
  );
}
/** 二维码等完整图片不超过容器，保留原始纵横比。 */
export function ResponsiveImage(
  props: Omit<ComponentProps<"img">, "className" | "style">,
) {
  return <img {...props} className="ui-responsive-image" />;
}
/** 阶段编号作为不可拆分的短语，正文仍允许换行。 */
export function NoWrap({ children }: { children: ReactNode }) {
  return <span className="ui-nowrap">{children}</span>;
}
/** 全局导航框架只暴露已确认的抽屉与收起状态。 */
export function AppShell({
  workbench,
  drawer,
  collapsed,
  ...props
}: BoxProps & { workbench: boolean; drawer: boolean; collapsed: boolean }) {
  return (
    <div
      {...props}
      className={`shell${workbench ? " workbench-shell" : ""}${drawer ? " drawer" : ""}${collapsed ? " rail-collapsed" : ""}`}
    />
  );
}

/** 看板标题、切换与新建工作项保持同排，长标题在可用空间内收缩。 */
export function BoardHeader(props: BoxProps) {
  return <div {...props} className="board-header ui-board-header" />;
}
/** 看板筛选采用单行搜索、归档切换及操作菜单，优先保留泳道空间。 */
export function BoardToolbar(props: BoxProps) {
  return <div {...props} className="toolbar ui-board-toolbar" />;
}

/** 两类会话共用工作台式头部：左侧标题/副标题，右侧状态及能力对应的操作。 */
export function ConversationHeader({
  title,
  navigation,
  actions,
  summary,
  status,
}: {
  title: string;
  navigation: ReactNode;
  actions: ReactNode;
  summary: string;
  status: ReactNode;
}) {
  return (
    <header className="chat-heading ui-conversation-header">
      {navigation}
      <div className="ui-conversation-copy">
        <h2 title={title}>{title}</h2>
        <small title={summary}>{summary}</small>
      </div>
      <div className="ui-conversation-actions">
        {status}
        {actions}
      </div>
    </header>
  );
}

/** 总览与详情分别滚动，窄屏详情占满视口并保留保存操作。 */
export function FlowLayout({
  overview,
  title,
  close,
  detail,
  toolbar,
  footer,
}: {
  overview: ReactNode;
  title?: ReactNode;
  close?: ReactNode;
  detail?: ReactNode;
  toolbar: ReactNode;
  footer?: ReactNode;
}) {
  const keepMobileFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (
      !detail ||
      !matchMedia("(max-width: 760px)").matches ||
      event.key !== "Tab"
    )
      return;
    if (!event.currentTarget.contains(event.target as Node)) return;
    const controls = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:enabled, input:enabled, textarea:enabled, [tabindex="0"]',
      ),
    ).filter(
      (node) =>
        node.getClientRects().length && !node.closest("[data-flow-overview]"),
    );
    const first = controls[0],
      last = controls.at(-1);
    if (
      (event.shiftKey && event.target === first) ||
      (!event.shiftKey && event.target === last)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  };
  return (
    <div
      className="ui-flow-layout"
      data-detail={!!detail}
      onKeyDown={keepMobileFocus}
    >
      <div className="ui-flow-toolbar">{toolbar}</div>
      <div className="ui-flow-overview" data-flow-overview>
        {overview}
      </div>
      {detail && (
        <section className="ui-flow-detail" data-flow-detail>
          <header className="ui-flow-detail-head">
            <h3 tabIndex={-1} data-flow-heading>
              {title}
            </h3>
            {close}
          </header>
          <div className="ui-flow-detail-body">{detail}</div>
        </section>
      )}
      {footer && <footer className="ui-flow-footer">{footer}</footer>}
    </div>
  );
}

/** 连线轨道与卡片共用坐标原点，手机保留卡片内的文字关系。 */
export function FlowDiagram({
  width,
  height,
  lines,
  children,
}: {
  width: number;
  height: number;
  lines: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="ui-flow-diagram"
      style={
        {
          "--flow-track-width": `${width}px`,
          "--flow-track-height": `${height}px`,
        } as CSSProperties
      }
    >
      {children}
      <div className="ui-flow-tracks">{lines}</div>
    </div>
  );
}
