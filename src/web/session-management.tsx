import {
  ActionMenu,
  Button,
  Check,
  ErrorBox,
  Modal,
  SurfaceButton,
  statusNames,
} from "./ui/index.js";
import {
  t as tr,
  useLocale,
  caughtFeedback,
  type UiFeedback,
} from "./locale.js";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Folder,
  Pencil,
  Trash2,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleX,
  Clock3,
  LoaderCircle,
  MoreHorizontal,
  OctagonX,
  Pause,
  ShieldAlert,
} from "lucide-react";
type SessionProject = { id: string; name: string; directories: unknown[] };

/** 会话页与项目管理使用同一已保存顺序，新项目追加在末尾。 */
export function orderedSessionProjects(
  projects: SessionProject[],
  ids: string[] = [],
): SessionProject[] {
  const remaining = new Map(projects.map((project) => [project.id, project]));
  const ordered: SessionProject[] = [];
  for (const id of ids) {
    const project = remaining.get(id);
    if (!project) continue;
    ordered.push(project);
    remaining.delete(id);
  }
  return [...ordered, ...remaining.values()];
}

/** 排序草稿仅在弹窗内生效；服务端确认后同步会话页。 */
export function ProjectManagement({
  projects,
  onClose,
  onCreate,
  onEdit,
  onDelete,
  onSaveOrder,
}: {
  projects: SessionProject[];
  onClose: () => void;
  onCreate: () => void;
  onEdit: (project: SessionProject) => void;
  onDelete: (id: string) => void;
  onSaveOrder: (ids: string[]) => Promise<void>;
}) {
  useLocale();
  const [draft, setDraft] = useState<string[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<UiFeedback>("");
  const orderButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const sorting = draft !== null;
  // 轮询发现并发增删时，保留仍存在的草稿项目并补齐新项目。
  const visible = sorting ? orderedSessionProjects(projects, draft) : projects;
  const changed = visible.some(
    (project, index) => project.id !== projects[index]?.id,
  );
  const finish = () => {
    setDraft(null);
    setError("");
    requestAnimationFrame(() => orderButton.current?.focus());
  };
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      await onSaveOrder(visible.map((project) => project.id));
      finish();
    } catch (e) {
      setError(caughtFeedback(e as Error));
      requestAnimationFrame(() => saveButton.current?.focus());
    } finally {
      setSaving(false);
    }
  };
  const move = (
    index: number,
    direction: -1 | 1,
    button: HTMLButtonElement,
  ) => {
    const ids = visible.map((project) => project.id);
    const target = index + direction;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    setDraft(ids);
    // 移到边界后焦点留在同一项目可用的方向按钮。
    const sibling =
      direction < 0 ? button.nextElementSibling : button.previousElementSibling;
    requestAnimationFrame(() => {
      if (button.disabled) (sibling as HTMLButtonElement | null)?.focus();
      else button.focus();
    });
  };
  return (
    <Modal title={tr("web.projectManagement")} onClose={onClose} busy={saving}>
      <p className="sub">
        {tr("web.sessionsAndBoardsShareProjectsAProjectCanReference")}
      </p>
      {visible.map((project, index) => (
        <div className="list-row project-management-row" key={project.id}>
          <Folder aria-hidden="true" size={16} />
          <strong>{project.name}</strong>
          <small>
            {project.directories.length} {tr("web.directories")}
          </small>
          <div className="project-management-actions">
            {sorting ? (
              <>
                <Button
                  shape="icon"
                  variant="ghost"
                  aria-label={tr("web.moveProjectUp", { name: project.name })}
                  title={tr("web.moveUp")}
                  disabled={saving || index === 0}
                  onClick={(event) => move(index, -1, event.currentTarget)}
                >
                  <ArrowUp aria-hidden="true" />
                </Button>
                <Button
                  shape="icon"
                  variant="ghost"
                  aria-label={tr("web.moveProjectDown", { name: project.name })}
                  title={tr("web.moveDown")}
                  disabled={saving || index === visible.length - 1}
                  onClick={(event) => move(index, 1, event.currentTarget)}
                >
                  <ArrowDown aria-hidden="true" />
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => onEdit(project)}
                  icon={<Pencil aria-hidden="true" />}
                >
                  {tr("web.edit")}
                </Button>
                <Button
                  onClick={() => onDelete(project.id)}
                  icon={<Trash2 aria-hidden="true" />}
                >
                  {tr("web.delete")}
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
      <ErrorBox error={error} />
      <footer className="project-management-footer">
        {sorting ? (
          <>
            <Button ref={cancelButton} disabled={saving} onClick={finish}>
              {tr("web.cancel")}
            </Button>
            <Button
              variant="primary"
              disabled={saving || (!changed && !error)}
              ref={saveButton}
              onClick={() => void save()}
            >
              {tr(saving ? "web.saving" : "web.save")}
            </Button>
          </>
        ) : (
          <>
            {projects.length > 1 && (
              <Button
                ref={orderButton}
                onClick={() => {
                  setDraft(projects.map((project) => project.id));
                  requestAnimationFrame(() => cancelButton.current?.focus());
                }}
              >
                {tr("web.adjustProjectOrder")}
              </Button>
            )}
            <Button variant="primary" onClick={onCreate}>
              {tr("web.newProject")}
            </Button>
          </>
        )}
      </footer>
    </Modal>
  );
}

/** 两种会话共享卡片入口；长按移动超过阈值时让出滚动，不误触导航。 */
export function SessionCard({
  title,
  active,
  selecting,
  checked,
  onCheck,
  onOpen,
  archived,
  onManage,
  onPin,
  pinned,
  pinBusy,
  rowId,
  onSelect,
  status,
}: any) {
  useLocale();
  const [signal, setSignal] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const start = useRef({ x: 0, y: 0 });
  const held = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);
  return (
    <div className="session-entry" id={rowId}>
      {selecting && (
        <Check checked={checked} onChange={onCheck}>
          <span className="sr-only">
            {tr("web.selectedSessionLabel", { title })}
          </span>
        </Check>
      )}
      <SurfaceButton
        selected={active}
        kind="session"

        title={title}
        aria-current={active ? "true" : undefined}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          held.current = false;
          start.current = { x: e.clientX, y: e.clientY };
          cancel();
          timer.current = setTimeout(() => {
            held.current = true;
            setSignal((v) => v + 1);
          }, 550);
        }}
        onPointerMove={(e) => {
          if (
            Math.hypot(
              e.clientX - start.current.x,
              e.clientY - start.current.y,
            ) > 10
          )
            cancel();
        }}
        onPointerUp={cancel}
        onPointerCancel={cancel}
        onPointerLeave={cancel}
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          held.current = true;
          setSignal((v) => v + 1);
        }}
        onClick={(event) => {
          if (held.current) {
            held.current = false;
            return;
          }
          selecting ? onCheck(!checked, event.shiftKey) : onOpen();
        }}
      >
        <SessionStatus value={status} />
        <strong>{title}</strong>
      </SurfaceButton>
      <ActionMenu
        label={tr("web.sessionActionsAlternative556") + title}

        openSignal={signal}
        icon={<MoreHorizontal aria-hidden="true" />}
        items={[
          ...(!archived && onPin ? [{
            label: pinned ? tr("web.unpinSession") : tr("web.pinSession"),
            disabled: pinBusy,
            onSelect: onPin,
          }] : []),
          {
            label: archived ? tr("web.unarchive") : tr("web.archive"),
            onSelect: () => onManage(archived ? "restore" : "archive"),
          },
          { label: tr("web.delete"), danger: true, onSelect: () => onManage("delete") },
          { label: tr("web.selectMultiple"), onSelect },
        ]}
      />
    </div>
  );
}

/** 批量操作始终仅作用于当前勾选项，筛选变化由调用方清空选择。 */
export function SessionBatch({
  visible,
  selection,
  setSelection,
  onExit,
  onManage,
  archived = false,
}: any) {
  useLocale();
  return (
    <div className="session-batch session-batch-footer">
      <Check
        checked={
          visible.length > 0 &&
          visible.every((s: any) => selection.includes(s.id))
        }
        onChange={(checked) =>
          setSelection(checked ? visible.map((s: any) => s.id) : [])
        }
      >
        {tr("web.selectAllInCurrentList")}
      </Check>
      <Button onClick={onExit}>{tr("web.exitSelection")}</Button>
      <small>{tr("web.selectionCount", { count: selection.length })}</small>
      <Button disabled={!selection.length} onClick={() => onManage("delete")}>
        {tr("web.deleteAll")}
      </Button>
      <Button
        disabled={!selection.length}
        onClick={() => onManage(archived ? "restore" : "archive")}
      >
        {archived ? tr("web.unarchiveAll") : tr("web.archiveAll")}
      </Button>
    </div>
  );
}

/** 状态以形状和可访问名称共同表达，未知值不误报为就绪。 */
function SessionStatus({ value }: { value: string }) {
  useLocale();
  const icons: Record<string, typeof Circle> = {
    idle: Circle,
    running: LoaderCircle,
    resuming: LoaderCircle,
    dispatching: LoaderCircle,
    queued: Clock3,
    waiting: Pause,
    approval: ShieldAlert,
    human: Pause,
    stopping: OctagonX,
    completed: CircleCheck,
    done: CircleCheck,
    cancelled: OctagonX,
    failed: CircleX,
    interrupted: CircleX,
    unknown: CircleHelp,
  };
  const Icon = icons[value] || CircleHelp;
  const label = statusNames[value] || tr("web.statusUnconfirmed");
  const spinning = ["running", "resuming", "dispatching"].includes(value);
  return (
    <span
      className={"session-status session-status-" + value}
      role="img"
      aria-label={label}
      title={label}
    >
      <Icon
        size={16}
        className={spinning ? "spin" : undefined}
        aria-hidden="true"
      />
    </span>
  );
}
