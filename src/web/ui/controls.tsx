import type { ComponentProps } from "react";
/** 结构型按钮使用有限语义变体，避免页面借 className 覆盖公共控件。 */
type ControlProps = Omit<ComponentProps<"button">, "className" | "style">;
const navigationClasses = {
  main: "",
  tab: "",
  settings: "",
  theme: "ui-theme-control",
  brand: "brand rail-toggle",
  profile: "profile-edit",
  archive: "workbench-archive-toggle",
};
/** 导航、页签与主题共用圆角反馈，语义状态由调用方明确提供。 */
export function NavigationButton({
  kind,
  selected = false,
  ...props
}: ControlProps & {
  kind: keyof typeof navigationClasses;
  selected?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      className={`ui-navigation ui-navigation-${kind} ${navigationClasses[kind]}${selected ? " active" : ""}`}
    />
  );
}
const surfaceClasses = {
  board: "board-card",
  flowStage: "ui-flow-stage",
  task: "task",
  agent: "agent-list-item",
  session: "session",
  suggestion: "suggest",
  recent: "recent-row",
  attachment: "attachment-open",
  activity: "workbench-activity-summary",
  file: "file-link",
};
/** 可点击卡片与列表具有内容承载语义，不采用固定宽高的操作按钮。 */
export function SurfaceButton({
  kind,
  selected = false,
  dragging = false,
  ...props
}: ControlProps & {
  kind: keyof typeof surfaceClasses;
  selected?: boolean;
  dragging?: boolean;
}) {
  return (
    <button
      {...props}
      type={props.type || "button"}
      className={`ui-surface-button ${surfaceClasses[kind]}${selected ? " active" : ""}${dragging ? " dragging" : ""}`}
    />
  );
}
/** 文件输入保留系统文件选择能力，外观交给可访问的标签或触发按钮。 */
export function FileInput(
  props: Omit<ComponentProps<"input">, "type" | "className" | "style">,
) {
  return <input {...props} type="file" className="ui-file-input" />;
}
/** 头像缩放使用标准滑块语义和统一触控高度。 */
export function Range(
  props: Omit<ComponentProps<"input">, "type" | "className" | "style">,
) {
  return <input {...props} type="range" className="ui-range" />;
}
/** 单输入标签允许条件切换密码/正文控件，保持原生标签关联。 */
export function InputLabel(
  props: Omit<ComponentProps<"label">, "className" | "style">,
) {
  return <label {...props} className="field ui-field" />;
}
/** 多个勾选项使用分组语义，避免把多个控件套进一个 label。 */
export function FieldGroup(
  props: Omit<ComponentProps<"div">, "className" | "style">,
) {
  return <div {...props} role="group" className="field ui-field" />;
}
/** 附件选择标签提供完整图标点击区域及原生文件选择能力。 */
export function AttachmentPicker({
  count = 0,
  children,
  ...props
}: Omit<ComponentProps<"label">, "className" | "style"> & { count?: number }) {
  return (
    <label {...props} className="attachment icon-button ui-attachment-picker">
      {children}
      {count > 0 && (
        <span className="ui-mark" aria-hidden="true">
          {count}
        </span>
      )}
    </label>
  );
}
/** 导航到资源仍使用链接语义，同时复用操作按钮外观。 */
export function LinkButton(
  props: Omit<ComponentProps<"a">, "className" | "style">,
) {
  return <a {...props} className="btn ui-button ui-button-secondary" />;
}
