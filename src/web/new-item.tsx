import { Textarea } from "./ui/index.js";
import { useBoardAttachments } from "./board-attachments.js";
import { caughtFeedback } from "./locale.js";
import { stageName } from "../shared/board-stages.js";
import {
  currentLocale,
  useLocale,
  feedback,
  displayError,
  type UiFeedback,
} from "./locale.js";
import { messages } from "../shared/i18n.js";
import React, { useEffect, useRef, useState } from "react";
import {
  api,
  Button,
  ErrorBox,
  Field,
  Input,
  Modal,
  Select,
} from "./ui/index.js";
import { itemCreationMessages } from "../shared/work-item-creation.js";

/** 新建工作项功能域资源；阶段名属于用户数据，不翻译。 */
export const creationTexts = {
  title: [
    messages["workItemCreation.ui.title"]["zh-CN"],
    messages["workItemCreation.ui.title"].en,
  ],
  name: [
    messages["workItemCreation.ui.name"]["zh-CN"],
    messages["workItemCreation.ui.name"].en,
  ],
  content: [
    messages["workItemCreation.ui.content"]["zh-CN"],
    messages["workItemCreation.ui.content"].en,
  ],
  start: [
    messages["workItemCreation.ui.start"]["zh-CN"],
    messages["workItemCreation.ui.start"].en,
  ],
  priority: [
    messages["workItemCreation.ui.priority"]["zh-CN"],
    messages["workItemCreation.ui.priority"].en,
  ],
  tags: [
    messages["workItemCreation.ui.tags"]["zh-CN"],
    messages["workItemCreation.ui.tags"].en,
  ],
  low: [
    messages["workItemCreation.ui.low"]["zh-CN"],
    messages["workItemCreation.ui.low"].en,
  ],
  normal: [
    messages["workItemCreation.ui.normal"]["zh-CN"],
    messages["workItemCreation.ui.normal"].en,
  ],
  high: [
    messages["workItemCreation.ui.high"]["zh-CN"],
    messages["workItemCreation.ui.high"].en,
  ],
  human: [
    messages["workItemCreation.ui.human"]["zh-CN"],
    messages["workItemCreation.ui.human"].en,
  ],
  agent: [
    messages["workItemCreation.ui.agent"]["zh-CN"],
    messages["workItemCreation.ui.agent"].en,
  ],
  done: [
    messages["workItemCreation.ui.done"]["zh-CN"],
    messages["workItemCreation.ui.done"].en,
  ],
  ask: [
    messages["workItemCreation.ui.ask"]["zh-CN"],
    messages["workItemCreation.ui.ask"].en,
  ],
  auto: [messages["web.autoApprove"]["zh-CN"], messages["web.autoApprove"].en],
  full: [
    messages["workItemCreation.ui.full"]["zh-CN"],
    messages["workItemCreation.ui.full"].en,
  ],
  default: [
    messages["workItemCreation.ui.default"]["zh-CN"],
    messages["workItemCreation.ui.default"].en,
  ],
  choose: [
    messages["workItemCreation.ui.choose"]["zh-CN"],
    messages["workItemCreation.ui.choose"].en,
  ],
  loading: [
    messages["workItemCreation.ui.loading"]["zh-CN"],
    messages["workItemCreation.ui.loading"].en,
  ],
  readFailed: [
    messages["workItemCreation.ui.readFailed"]["zh-CN"],
    messages["workItemCreation.ui.readFailed"].en,
  ],
  refresh: [
    messages["workItemCreation.ui.refresh"]["zh-CN"],
    messages["workItemCreation.ui.refresh"].en,
  ],
  review: [
    messages["workItemCreation.ui.review"]["zh-CN"],
    messages["workItemCreation.ui.review"].en,
  ],
  missing: [
    messages["workItemCreation.ui.missing"]["zh-CN"],
    messages["workItemCreation.ui.missing"].en,
  ],
  uncertain: [
    messages["workItemCreation.ui.uncertain"]["zh-CN"],
    messages["workItemCreation.ui.uncertain"].en,
  ],
  retry: [
    messages["workItemCreation.ui.retry"]["zh-CN"],
    messages["workItemCreation.ui.retry"].en,
  ],
  submit: [
    messages["workItemCreation.ui.submit"]["zh-CN"],
    messages["workItemCreation.ui.submit"].en,
  ],
  busy: [
    messages["workItemCreation.ui.busy"]["zh-CN"],
    messages["workItemCreation.ui.busy"].en,
  ],
  close: [
    messages["workItemCreation.ui.close"]["zh-CN"],
    messages["workItemCreation.ui.close"].en,
  ],
  offline: [
    messages["workItemCreation.ui.offline"]["zh-CN"],
    messages["workItemCreation.ui.offline"].en,
  ],
  failed: [
    messages["workItemCreation.ui.failed"]["zh-CN"],
    messages["workItemCreation.ui.failed"].en,
  ],
  created: [
    messages["workItemCreation.ui.created"]["zh-CN"],
    messages["workItemCreation.ui.created"].en,
  ],
} satisfies Record<string, readonly [string, string]>;

/** 与现有功能级语言入口一致，避免引入另一套语言偏好。 */
export function creationText(
  key: keyof typeof creationTexts,
  params: Record<string, string> = {},
) {
  let value: string = creationTexts[key][creationLocale() === "en" ? 1 : 0];
  for (const [name, replacement] of Object.entries(params))
    value = value.replaceAll(`{${name}}`, replacement);
  return value;
}
function creationLocale(): "zh-CN" | "en" {
  return typeof document !== "undefined" &&
    document.documentElement.lang.startsWith("en")
    ? "en"
    : "zh-CN";
}
function message(key: keyof typeof itemCreationMessages) {
  return itemCreationMessages[key][creationLocale()];
}
type Stage = {
  id: string;
  name: string;
  nameKey?: string;
  fixedRole?: "start";
  type: "human" | "agent" | "done";
  permission?: "ask" | "auto" | "full";
  shortId?: string;
};
type Board = { id: string; version: number; stages: Stage[] };

/** 表单和工作台审批共同显示真实阶段效果，完全权限沿用危险色。 */
export function CreationEffect({ stage }: { stage: Stage }) {
  useLocale();
  return (
    <p role="status" className="note creation-effect">
      {message(stage.type)}
      {stage.type === "agent" && (
        <strong className={stage.permission === "full" ? "danger" : ""}>
          {" "}
          · {creationText(stage.permission ?? "ask")}
        </strong>
      )}
    </p>
  );
}

/** 仅解读服务端冻结的审批摘要；不修改 SDK 调用参数。 */
export function CreationApproval({ arguments: args }: { arguments: unknown }) {
  useLocale();
  try {
    const value = typeof args === "string" ? JSON.parse(args) : args;
    const stage = value?.startStage;
    if (!stage?.id || !["human", "agent", "done"].includes(stage.type))
      return null;
    return (
      <section className="creation-approval">
        <strong>
          {creationText("start")} · {stageName(stage, currentLocale())} ·{" "}
          {creationText(stage.type)}
        </strong>
        <CreationEffect stage={stage} />
      </section>
    );
  } catch {
    return null;
  }
}

/** 保留创建快照，结果不明时只能原样重发，不能改参后生成另一条任务。 */
export function NewItem({
  state,
  boardId,
  liveBoard,
  onClose,
  onSaved,
}: {
  state: any;
  boardId: string;
  liveBoard?: Board;
  onClose: () => void;
  onSaved: (item: any, stage: string) => void;
}) {
  useLocale();
  const [form, setForm] = useState({
    title: "",
    content: "",
    priority: "normal",
    tags: "",
  });
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState<Stage | null>(null);
  const attachments = useBoardAttachments(state, board, selected);
  const [loading, setLoading] = useState(true);
  const [needsRead, setNeedsRead] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [error, setError] = useState<UiFeedback>("");
  const [notice, setNotice] = useState<UiFeedback>("");
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const lock = useRef(false);
  const request = useRef<any>(null);
  const initialized = useRef(false);
  const mounted = useRef(true);

  async function read() {
    setLoading(true);
    setError("");
    try {
      const { changes } = await api("/state/query", { groups: ["board"], boardId: boardId }, "POST", 15000);
      if (!mounted.current) return;
      const latest: Board | undefined = changes.board.value;
      if (!latest) {
        setBlocked(true);
        setError(creationFeedback("missing"));
        return;
      }
      const first = latest.stages.find((s) => s.fixedRole === "start");
      if (!initialized.current) setSelected(first || null);
      else {
        const next = latest.stages.find((s) => s.id === selected?.id);
        if (next && next.type === selected?.type) setSelected(next);
        else {
          setSelected(null);
          setError(creationError("INVALID_START_STAGE"));
        }
        setNotice(creationFeedback("review"));
      }
      initialized.current = true;
      setBoard(latest);
      setNeedsRead(false);
    } catch (e: any) {
      if ([401, 403, 404].includes(e.status)) {
        setBlocked(true);
        setError(creationFeedback("missing"));
      } else setError(creationFeedback("readFailed"));
      setNeedsRead(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }
  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
    };
  }, [boardId]);
  // 轮询只提示过期，不能悄悄采用用户尚未核对的新权限或版本。
  useEffect(() => {
    if (
      board &&
      liveBoard &&
      liveBoard.version > board.version &&
      !uncertain &&
      !busy
    ) {
      setNeedsRead(true);
      setError(creationError("BOARD_VERSION_CONFLICT"));
    }
  }, [liveBoard?.version, board?.version, uncertain, busy]);
  const stages =
    board?.stages.filter((s) => ["human", "agent", "done"].includes(s.type)) ||
    [];
  const first = stages.find((s) => s.fixedRole === "start");
  const frozen = busy || uncertain;
  const valid =
    !!first &&
    !!selected &&
    !needsRead &&
    !loading &&
    !blocked &&
    !attachments.issue;

  async function submit() {
    if (lock.current || blocked || (!uncertain && !valid)) return;
    if (!navigator.onLine) {
      setError(creationFeedback(uncertain ? "uncertain" : "offline"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    if (!request.current)
      request.current = {
        ...form,
        boardId,
        startStageId: selected!.id,
        boardVersion: board!.version,
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        operationId: crypto.randomUUID(),
      };
    try {
      if (!uncertain) {
        try {
          Object.assign(
            request.current,
            await attachments.prepare(request.current.operationId),
          );
        } catch (error) {
          request.current = null;
          setError(caughtFeedback(error));
          return;
        }
      }
      const item = await api("/items", request.current, "POST", 15000);
      onSaved(
        item,
        stageName(
          stages.find((s) => s.id === item.stageId) || { name: item.stageId },
          currentLocale(),
        ),
      );
    } catch (e: any) {
      if (e.code === "IDEMPOTENCY_CONFLICT") {
        setBlocked(true);
        setUncertain(false);
        setError(creationError("IDEMPOTENCY_CONFLICT"));
      } else if (!e.status || e.status >= 500) {
        setUncertain(true);
        setError(creationFeedback("uncertain"));
      } else {
        // 明确拒绝才允许修改草稿及生成新操作；配置冲突必须先刷新。
        const attached = !!request.current.attachmentReceipt;
        request.current = null;
        setUncertain(false);
        if (
          attached &&
          ![
            "BOARD_VERSION_CONFLICT",
            "INVALID_START_STAGE",
            "NO_START_STAGE",
          ].includes(e.code)
        ) {
          setError(caughtFeedback(e));
        } else if ([401, 403, 404].includes(e.status)) {
          setBlocked(true);
          setError(creationFeedback("missing"));
        } else {
          setNeedsRead(true);
          setError(
            e.code in itemCreationMessages
              ? creationError(e.code)
              : creationFeedback("failed"),
          );
        }
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal
      title={creationText("title")}
      closeLabel={creationText("close")}
      onClose={onClose}
      busy={frozen}
      closeOnBackdrop={false}
      trapFocus
    >
      <form
        className="new-item-form"
        aria-busy={busy || loading}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Field label={creationText("name")}>
          <Input
            data-initial-focus
            required
            maxLength={200}
            readOnly={frozen}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
          />
        </Field>
        <Field label={creationText("content")}>
          <Textarea
            rows={6}
            readOnly={frozen}
            value={form.content}
            onChange={(e) => setForm({ ...form, content: e.target.value })}
          />
        </Field>
        <Field label={creationText("start")}>
          <Select
            label={creationText("start")}
            value={selected?.id || ""}
            disabled={frozen || loading || needsRead || blocked}
            options={[
              ...(!selected
                ? [{ value: "", label: creationText("choose") }]
                : []),
              ...stages.map((s, index) => ({
                value: s.id,
                label: `${index + 1}. ${stageName(s, currentLocale())} · ${creationText(s.type)}${s.id === first?.id ? ` · ${creationText("default")}` : ""}`,
                danger: s.type === "agent" && s.permission === "full",
              })),
            ]}
            onChange={(id) => {
              setSelected(stages.find((s) => s.id === id) || null);
              setError("");
            }}
          />
        </Field>
        {selected && <CreationEffect stage={selected} />}
        {attachments.fields(frozen)}
        <p role="status" className="note">
          {loading
            ? creationText("loading")
            : !first && board
              ? message("NO_START_STAGE")
              : displayError(notice)}
        </p>
        <Field label={creationText("priority")}>
          <Select
            label={creationText("priority")}
            value={form.priority}
            disabled={frozen}
            options={["low", "normal", "high"].map((value) => ({
              value,
              label: creationText(value as "low" | "normal" | "high"),
            }))}
            onChange={(priority) => setForm({ ...form, priority })}
          />
        </Field>
        <Field label={creationText("tags")}>
          <Input
            readOnly={frozen}
            value={form.tags}
            onChange={(e) => setForm({ ...form, tags: e.target.value })}
          />
        </Field>
        <ErrorBox error={error} />
        <footer>
          {(needsRead || !first) && !uncertain && !blocked && (
            <Button
              type="button"
              disabled={loading || busy}
              onClick={() => void read()}
            >
              {creationText("refresh")}
            </Button>
          )}
          <Button
            variant="primary"
            type="submit"
            disabled={busy || blocked || (!uncertain && !valid)}
          >
            {creationText(busy ? "busy" : uncertain ? "retry" : "submit")}
          </Button>
        </footer>
      </form>
    </Modal>
  );
}

/** 创建提示在展示时按当前语言重算，草稿与原请求保持不变。 */
function creationFeedback(key: keyof typeof creationTexts) {
  return feedback(`workItemCreation.ui.${key}`);
}
function creationError(key: keyof typeof itemCreationMessages) {
  return feedback(`workItemCreation.${key}`);
}
