import { SurfaceButton, FileInput } from "./ui/index.js";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { File as FileIcon, Paperclip, RotateCcw, X } from "lucide-react";
import { Button, ErrorBox } from "./ui/index.js";
import {
  caughtFeedback,
  feedback,
  t as tr,
  useLocale,
  type UiFeedback,
} from "./locale.js";
import { uploadAttachment } from "./attachment-upload.js";
import {
  uploadEntrySchema,
  uploadEntriesSchema,
  type Attachment,
} from "../shared/uploads.js";
import { fileFormat, previewLimits, type FileTicket } from "../shared/files.js";
import {
  fileRequest,
  receiveEnvironmentFile,
  formatBytes,
  type TransferProgress,
} from "./file-transfer.js";

type DraftAttachment = {
  id: string;
  file: File;
  status: "queued" | "uploading" | "ready" | "failed";
  attachment?: Attachment;
  progress?: TransferProgress;
  error?: UiFeedback;
  abort?: AbortController;
};

/** 草稿只驻留当前会话内存；队列串行，切换目录或离开页面后不恢复、不重放。 */
export function useSessionAttachments(
  scope: string,
  sessionId: string,
  allowed: boolean,
) {
  const [items, setItems] = useState<DraftAttachment[]>([]);
  const [error, setError] = useState<UiFeedback>("");
  const rows = useRef<DraftAttachment[]>([]);
  const running = useRef(false);
  const generation = useRef(0);
  const enabled = useRef(allowed);
  enabled.current = allowed;
  const publish = () => setItems([...rows.current]);
  const clear = () => {
    generation.current++;
    for (const row of rows.current) row.abort?.abort();
    rows.current = [];
    running.current = false;
    publish();
    setError("");
  };
  const stop = () => {
    for (const row of rows.current) {
      if (row.status === "queued" || row.status === "uploading") {
        row.abort?.abort();
        row.status = "failed";
        row.error = feedback("uploads.blocked");
      }
    }
    publish();
  };
  useEffect(() => {
    clear();
    const offline = () => stop();
    const hide = () => clear();
    addEventListener("offline", offline);
    addEventListener("pagehide", hide);
    return () => {
      removeEventListener("offline", offline);
      removeEventListener("pagehide", hide);
      clear();
    };
  }, [scope]);
  useEffect(() => {
    if (!allowed) stop();
  }, [allowed]);
  const pump = async () => {
    if (running.current || !enabled.current) return;
    running.current = true;
    const version = generation.current;
    try {
      while (enabled.current && version === generation.current) {
        const row = rows.current.find((row) => row.status === "queued");
        if (!row) break;
        row.status = "uploading";
        row.abort = new AbortController();
        const abort = row.abort;
        publish();
        try {
          const receipt = await uploadAttachment(
            sessionId,
            row.file,
            abort.signal,
            (progress) => {
              if (version !== generation.current || abort.signal.aborted)
                return;
              row.progress = progress;
              publish();
            },
          );
          if (version !== generation.current || abort.signal.aborted) continue;
          row.attachment = receipt;
          row.status = "ready";
        } catch (e) {
          if (version !== generation.current) return;
          row.status = "failed";
          row.error = abort.signal.aborted
            ? feedback("uploads.blocked")
            : caughtFeedback(e);
        } finally {
          if (row.abort === abort) row.abort = undefined;
        }
        if (version === generation.current) publish();
      }
    } finally {
      if (version === generation.current) running.current = false;
    }
  };
  const add = (files: File[]) => {
    if (!allowed || !navigator.onLine) {
      setError(feedback("uploads.blocked"));
      return;
    }
    if (!files.length) return;
    const invalid = files.find(
      (file) =>
        !uploadEntrySchema.safeParse({ name: file.name, size: file.size })
          .success,
    );
    if (invalid) {
      setError(feedback("attachments.invalidFile", { name: invalid.name }));
      return;
    }
    const entries = [...rows.current.map((r) => r.file), ...files].map((f) => ({
      name: f.name,
      size: f.size,
    }));
    if (!uploadEntriesSchema.safeParse(entries).success) {
      setError(feedback("attachments.limits"));
      return;
    }
    setError("");
    rows.current.push(
      ...files.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "queued" as const,
      })),
    );
    publish();
    void pump();
  };
  return {
    items,
    error,
    add,
    clear,
    blocked: items.some((row) => row.status !== "ready"),
    restore: (saved: DraftAttachment[]) => { rows.current = [...saved]; publish(); },
    attachments: items.flatMap((row) =>
      row.attachment ? [row.attachment] : [],
    ),
    remove: (id: string) => {
      rows.current.find((row) => row.id === id)?.abort?.abort();
      rows.current = rows.current.filter((row) => row.id !== id);
      publish();
    },
    retry: (id: string) => {
      const row = rows.current.find((row) => row.id === id);
      if (!row || row.abort || !allowed) return;
      row.status = "queued";
      row.error = "";
      row.progress = undefined;
      publish();
      void pump();
    },
  };
}

/** 缩略图从授权文件通道读取；仅可见项加载，离线/卸载即释放，不持久化旧图。 */
export function AttachmentLink({
  sessionId,
  href,
  name,
  onOpen,
  online = true,
}: {
  sessionId: string;
  href: string;
  name: ReactNode;
  onOpen: () => void;
  online?: boolean;
}) {
  useLocale();
  const button = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState("");
  const [error, setError] = useState<UiFeedback>("");
  useEffect(() => {
    setUrl("");
    setError("");
    if (!online || fileFormat(href).kind !== "image") return;
    const abort = new AbortController();
    let objectUrl = "",
      ticketId = "",
      started = false;
    const cleanup = () => {
      abort.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl("");
      if (ticketId)
        void fileRequest(
          `/file-transfers/${ticketId}`,
          undefined,
          undefined,
          "DELETE",
        ).catch(() => {});
    };
    const observer = new IntersectionObserver((entries) => {
      if (started || !entries.some((e) => e.isIntersecting)) return;
      started = true;
      void (async () => {
        try {
          const ticket: FileTicket = await (
            await fileRequest(`/sessions/${sessionId}/files`, { href })
          ).json();
          ticketId = ticket.id;
          abort.signal.throwIfAborted();
          if (ticket.kind !== "image" || ticket.size > previewLimits.image)
            return;
          const chunks: BlobPart[] = [];
          await receiveEnvironmentFile(
            ticket,
            async (bytes) => {
              chunks.push(bytes as Uint8Array<ArrayBuffer>);
            },
            () => {},
            abort.signal,
          );
          abort.signal.throwIfAborted();
          objectUrl = URL.createObjectURL(
            new Blob(chunks, { type: ticket.mime }),
          );
          setUrl(objectUrl);
        } catch (e) {
          if (!abort.signal.aborted) setError(caughtFeedback(e));
        } finally {
          if (ticketId)
            void fileRequest(
              `/file-transfers/${ticketId}`,
              undefined,
              undefined,
              "DELETE",
            ).catch(() => {});
          ticketId = "";
        }
      })();
    });
    if (button.current) observer.observe(button.current);
    addEventListener("offline", cleanup);
    return () => {
      observer.disconnect();
      removeEventListener("offline", cleanup);
      cleanup();
    };
  }, [sessionId, href, online]);
  return (
    <span className="attachment-link-wrap">
      <SurfaceButton
        kind="attachment"
        ref={button}
        type="button"

        onClick={onOpen}
        title={href}
      >
        {url ? (
          <img
            className="attachment-thumb"
            src={url}
            alt=""
            onError={() => {
              setUrl("");
              setError(feedback("web.cannotReadThisImageChooseAValidImage"));
            }}
          />
        ) : (
          <FileIcon className="attachment-thumb" aria-hidden="true" />
        )}
        <span className="attachment-name">{name}</span>
      </SurfaceButton>
      {!!error && <ErrorBox error={error} />}
    </span>
  );
}

/** 上传入口与状态条沿用统一按钮，预览和移除是独立触控及键盘目标。 */
export function AttachmentPicker({
  uploads,
  sessionId,
  disabled,
  capable,
  online,
  onOpen,
}: {
  uploads: ReturnType<typeof useSessionAttachments>;
  sessionId: string;
  disabled: boolean;
  capable: boolean;
  online: boolean;
  onOpen: (href: string) => void;
}) {
  useLocale();
  return (
    <>
      {!capable && <small className="note">{tr("uploads.upgrade")}</small>}
      <ErrorBox error={uploads.error} />
      {!!uploads.items.length && (
        <div
          className="attachment-strip"
          role="list"
          aria-label={tr("attachments.list")}
        >
          {uploads.items.map((row) => (
            <div className="attachment-item" role="listitem" key={row.id}>
              {row.attachment ? (
                <AttachmentLink
                  sessionId={sessionId}
                  href={row.attachment.path}
                  name={row.file.name}
                  online={online}
                  onOpen={() => onOpen(row.attachment!.path)}
                />
              ) : (
                <span className="attachment-open" title={row.file.name}>
                  <LocalThumbnail file={row.file} />
                  <span className="attachment-name">{row.file.name}</span>
                </span>
              )}
              <div className="attachment-status" role="status">
                <span>
                  {formatBytes(row.file.size)} ·{" "}
                  {tr(`attachments.${row.status}`)}
                </span>
                {row.progress && row.status === "uploading" && (
                  <>
                    <progress
                      value={row.progress.received}
                      max={Math.max(1, row.progress.total)}
                      aria-label={row.file.name}
                    />
                    <small>
                      {formatBytes(row.progress.received)} /{" "}
                      {formatBytes(row.progress.total)} ·{" "}
                      {formatBytes(row.progress.speed)}/s
                    </small>
                  </>
                )}
                <ErrorBox error={row.error || ""} />
              </div>
              {row.status === "failed" && (
                <Button
                  placement="attachment-action"
                  shape="icon"

                  disabled={disabled}
                  aria-label={tr("attachments.retry", { name: row.file.name })}
                  onClick={() => uploads.retry(row.id)}
                >
                  <RotateCcw size={16} />
                </Button>
              )}
              <Button
                placement="attachment-action"
                shape="icon"

                aria-label={tr("attachments.remove", { name: row.file.name })}
                onClick={() => uploads.remove(row.id)}
              >
                <X size={16} />
              </Button>
            </div>
          ))}
        </div>
      )}
      {uploads.blocked && (
        <small className="note" role="status">
          {tr("attachments.wait")}
        </small>
      )}
    </>
  );
}

/** 工具栏附件入口复用原上传队列，状态列表独立留在输入区上方。 */
export function AttachmentButton({
  count = 0,
  disabled,
  capable,
  onAdd,
}: {
  disabled: boolean;
  capable: boolean;
  count?: number;
  onAdd: (files: File[]) => void;
}) {
  useLocale();
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="attachment-picker">
      <Button
        mark={count ? String(count) : undefined}
        placement="attachment-add"
        shape="icon"

        aria-label={tr("attachments.add")}
        disabled={disabled || !capable}
        title={tr(capable ? "attachments.add" : "uploads.upgrade")}
        onClick={() => input.current?.click()}
      >
        <Paperclip size={18} aria-hidden="true" />
      </Button>
      <FileInput
        ref={input}

        multiple
        hidden
        aria-label={tr("attachments.add")}
        disabled={disabled || !capable}
        onChange={(e) => {
          onAdd(Array.from(e.target.files || []));
          e.target.value = "";
        }}
      />
    </div>
  );
}

/** 未完成时仅为用户刚选择的安全图片创建本地预览；完成后改读环境文件。 */
function LocalThumbnail({ file }: { file: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const format = fileFormat(file.name);
    if (format.kind !== "image" || file.size > previewLimits.image) return;
    const objectUrl = URL.createObjectURL(
      file.slice(0, file.size, format.mime),
    );
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);
  return url ? (
    <img
      className="attachment-thumb"
      src={url}
      alt=""
      onError={() => setUrl("")}
    />
  ) : (
    <FileIcon className="attachment-thumb" aria-hidden="true" />
  );
}
