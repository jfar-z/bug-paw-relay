import React, { useEffect, useMemo, useRef, useState } from "react";
import { Paperclip, X } from "lucide-react";
import {
  AttachmentPicker,
  Button,
  Field,
  FileInput,
  IconButton,
  Select,
} from "./ui/index.js";
import { t, feedback, FeedbackError } from "./locale.js";
import { uploadBatch } from "./attachment-upload.js";
import { uploadEntriesSchema } from "../shared/uploads.js";

type Directory = {
  environmentId: string;
  rootId: string;
  relativePath: string;
};
const key = (d: Directory) =>
  JSON.stringify([d.environmentId, d.rootId, d.relativePath]);

/** 两种表单保留原始文件；仅在业务提交时向当前选择的项目目录传输。 */
export function useBoardAttachments(
  state: any,
  board: any,
  stage: any,
  itemId?: string,
  editVersion?: number,
) {
  const [files, setFiles] = useState<File[]>([]);
  const [choice, setChoice] = useState("");
  const [percent, setPercent] = useState<number | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const dirs: Directory[] =
    state.projects.find((p: any) => p.id === board?.projectId)?.directories ||
    [];
  const fixed = stage?.type === "agent" || dirs.length === 1;
  const directory =
    stage?.type === "agent"
      ? dirs.find((d) => key(d) === key(stage))
      : dirs.length === 1
        ? dirs[0]
        : dirs.find((d) => key(d) === choice);
  const label = (d: Directory) => {
    const env = state.environments.find((e: any) => e.id === d.environmentId);
    return [env?.name || d.environmentId, d.rootId, d.relativePath].join(" · ");
  };
  let issue = "";
  if (files.length) {
    if (
      !uploadEntriesSchema.safeParse(
        files.map(({ name, size }) => ({ name, size })),
      ).success
    )
      issue = t("attachments.limits");
    else if (!directory)
      issue = t(
        dirs.length && !fixed
          ? "board.upload.choose"
          : "board.upload.unavailable",
      );
  }
  async function prepare(operationId: string) {
    if (!files.length) return {};
    if (issue || !stage || !directory) throw new Error(issue);
    const transfer = new AbortController();
    controller.current = transfer;
    setPercent(0);
    try {
      const result = await uploadBatch(
        `/boards/${board.id}/uploads`,
        { stageId: stage.id, itemId, editVersion, directory, operationId },
        files,
        transfer.signal,
        ({ received, total }) =>
          setPercent(total ? Math.floor((received * 100) / total) : 0),
      );
      if (!result.attachmentReceipt)
        throw new FeedbackError(feedback("uploads.incomplete"));
      return { attachmentReceipt: result.attachmentReceipt as string };
    } catch (error) {
      if (transfer.signal.aborted)
        throw new FeedbackError(
          feedback("web.transferCancelledYouCanTryAgain"),
        );
      throw error;
    } finally {
      controller.current = null;
      setPercent(null);
    }
  }
  function fields(disabled: boolean) {
    return (
      <section aria-label={t("ui.attachments")}>
        <AttachmentPicker title={t("attachments.add")}>
          <Paperclip aria-hidden="true" />
          <FileInput
            multiple
            aria-label={t("attachments.add")}
            disabled={disabled}
            onChange={(e) => {
              const added = Array.from(e.currentTarget.files || []);
              setFiles((old) => [...old, ...added]);
              e.currentTarget.value = "";
            }}
          />
        </AttachmentPicker>
        {files.length > 0 && (
          <>
            <ul className="handoff-artifacts">
              {files.map((file, index) => (
                <li key={index}>
                  <div>{file.name}</div>
                  <IconButton
                    icon={<X />}
                    label={t("attachments.remove", { name: file.name })}
                    disabled={disabled}
                    onClick={() =>
                      setFiles((old) => old.filter((_, i) => i !== index))
                    }
                  />
                </li>
              ))}
            </ul>
            {directory && fixed && (
              <p className="prose">
                {t("web.projectExecutionDirectory")} · {label(directory)}
              </p>
            )}
            {!fixed && dirs.length > 0 && (
              <Field label={t("web.projectExecutionDirectory")}>
                <Select
                  label={t("web.projectExecutionDirectory")}
                  value={directory ? key(directory) : ""}
                  disabled={disabled}
                  options={[
                    { value: "", label: t("board.upload.choose") },
                    ...dirs.map((d) => ({ value: key(d), label: label(d) })),
                  ]}
                  onChange={setChoice}
                />
              </Field>
            )}
            {issue && <p role="status">{issue}</p>}
            {percent !== null && (
              <>
                <span role="status">
                  {t("attachments.uploading")} {percent}%
                </span>
                <Button onClick={() => controller.current?.abort()}>
                  {t("web.cancelTransfer")}
                </Button>
              </>
            )}
          </>
        )}
      </section>
    );
  }
  const directoryKey = directory && key(directory);
  const draftId = useMemo(
    () => (files.length ? crypto.randomUUID() : ""),
    [files, directoryKey],
  );
  return { prepare, fields, issue, draftId };
}
