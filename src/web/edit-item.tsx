import React, { useRef, useState } from "react";
import { X } from "lucide-react";
import type { Attachment } from "../shared/uploads.js";
import { useBoardAttachments } from "./board-attachments.js";
import { caughtFeedback, feedback, t, useLocale, type UiFeedback } from "./locale.js";
import { api, Button, ErrorBox, Field, IconButton, Input, Modal, Textarea } from "./ui/index.js";

export type EditView = {
  item: { id: string; stageId: string; version: number; title: string; content: string };
  attachments: (Attachment & { referenceId: string; environmentName: string; cwd: string })[];
};

/** 固定打开时的版本与附件引用，后台轮询不得覆盖未保存的草稿。 */
export function EditItem({ view, state, board, onClose, onSaved }: {
  view: EditView; state: any; board: any; onClose: () => void; onSaved: (item: any) => void;
}) {
  useLocale();
  const { item } = view;
  const [title, setTitle] = useState(item.title);
  const [content, setContent] = useState(item.content);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState<UiFeedback>("");
  const lock = useRef(false);
  const previous = useRef<{ draft: string; body: Record<string, unknown> } | null>(null);
  const uploads = useBoardAttachments(state, board, { id: item.stageId, type: "human" }, item.id, item.version);
  const retained = view.attachments.filter(a => !removed.includes(a.referenceId));

  async function save() {
    if (lock.current || conflict || uploads.issue || !title.trim()) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      // 网络中断后，未改动的请求复用原凭据与操作号。
      const draft = JSON.stringify([title, content, removed, uploads.draftId]);
      if (previous.current?.draft !== draft) {
        const operationId = crypto.randomUUID();
        const receipt = await uploads.prepare(operationId);
        previous.current = { draft, body: {
          title, content, removeAttachmentIds: removed, expectedStageId: item.stageId,
          expectedVersion: item.version, operationId, ...receipt,
        } };
      }
      onSaved(await api("/items/" + item.id, previous.current.body, "PATCH", 15000));
    } catch (e: any) {
      if (e.status && e.status < 500) previous.current = null;
      const stale = e.code === "CONFLICT" || e.code === "IDEMPOTENCY_CONFLICT";
      setConflict(stale);
      setError(stale ? feedback("board.edit.conflict") : caughtFeedback(e));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return <Modal title={t("board.edit.title")} onClose={onClose} busy={busy}>
    <form className="new-item-form" aria-busy={busy} onSubmit={e => { e.preventDefault(); void save(); }}>
      <Field label={t("workItemCreation.ui.name")}>
        <Input data-initial-focus required maxLength={200} readOnly={busy} value={title} onChange={e => setTitle(e.target.value)} />
      </Field>
      <Field label={t("workItemCreation.ui.content")}>
        <Textarea rows={6} maxLength={100000} readOnly={busy} value={content} onChange={e => setContent(e.target.value)} />
      </Field>
      <section aria-label={t("board.edit.attachments")}>
        <h3>{t("board.edit.attachments")}</h3>
        {retained.length ? <ul className="handoff-artifacts">
          {retained.map(a => <li key={a.referenceId}>
            <div><strong>{a.name}</strong><small>{a.environmentName} · {a.cwd}</small><code>{a.path}</code></div>
            <IconButton icon={<X />} label={t("attachments.remove", { name: a.name })} disabled={busy}
              onClick={() => setRemoved(ids => [...ids, a.referenceId])} />
          </li>)}
        </ul> : <p className="note">{t("board.edit.empty")}</p>}
      </section>
      {uploads.fields(busy)}
      <ErrorBox error={error} />
      <footer>
        <Button type="button" disabled={busy} onClick={onClose}>{t("web.cancel")}</Button>
        <Button type="submit" variant="primary" disabled={busy || conflict || !!uploads.issue || !title.trim()}>
          {t(busy ? "web.processing" : "web.save")}
        </Button>
      </footer>
    </form>
  </Modal>;
}
