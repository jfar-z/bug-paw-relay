import {
  FeedbackError,
  feedback,
  caughtFeedback,
  type UiFeedback,
} from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Modal, Button, ErrorBox, MarkdownCodeBlock, Sections } from "./ui/index.js";
import {
  classifyFileLink,
  previewLimits,
  type FileTicket,
} from "../shared/files.js";
import {
  fileRequest,
  receiveEnvironmentFile,
  createFileSink,
  formatBytes,
  type TransferProgress,
} from "./file-transfer.js";
import "./ui/environment-file.css";
/** 文件查看复用公共弹窗，信息、传输和预览均保留明确的关闭与错误出口。 */
export function EnvironmentFile({
  sessionId,
  artifactId,
  environmentName,
  href,
  onClose,
}: {
  sessionId: string;
  artifactId?: string;
  environmentName: string;
  href: string;
  onClose: () => void;
}) {
  useLocale();
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;
  const [ticket, setTicket] = useState<
    FileTicket & { originalName?: string }
  >();
  const [error, setError] = useState<UiFeedback>("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState<"preview" | "download" | "">("");
  const [progress, setProgress] = useState<TransferProgress>();
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<{ url?: string; text?: string }>();
  const [rawText, setRawText] = useState(false);
  const [download, setDownload] = useState("");
  const controller = useRef<AbortController | null>(null);
  const urls = useRef<string[]>([]);
  const cleanups = useRef<(() => Promise<void>)[]>([]);
  useEffect(() => {
    let active = true,
      id = "";
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setTicket(undefined);
    void fileRequest(
      artifactId
        ? `/artifacts/${artifactId}/files`
        : `/sessions/${sessionId}/files`,
      artifactId ? {} : { href },
      abort.signal,
    )
      .then((r) => r.json())
      .then((info) => {
        id = info.id;
        if (active) setTicket(info);
        else
          void fileRequest(
            `/file-transfers/${id}`,
            undefined,
            undefined,
            "DELETE",
          ).catch(() => {});
      })
      .catch((e) => {
        if (active) setError(caughtFeedback(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
      abort.abort();
      controller.current?.abort();
      if (id)
        void fileRequest(
          `/file-transfers/${id}`,
          undefined,
          undefined,
          "DELETE",
        ).catch(() => {});
    };
  }, [sessionId, href, artifactId, revision]);
  async function releaseArtifacts() {
    urls.current.splice(0).forEach((url) => URL.revokeObjectURL(url));
    await Promise.all(cleanups.current.splice(0).map((cleanup) => cleanup()));
  }
  useEffect(() => {
    const cleanup = () => {
      controller.current?.abort();
      void releaseArtifacts();
    };
    addEventListener("pagehide", cleanup);
    return () => {
      removeEventListener("pagehide", cleanup);
      cleanup();
    };
  }, []);
  const extension = artifactId
    ? (ticket?.originalName || "").split(".").at(-1)?.toLowerCase()
    : "";
  const pdf = extension === "pdf";
  const html = extension === "html" || extension === "htm";
  // 会话文件使用票据中的最终文件名，交接产物仍按原始名称展示。
  const sessionMarkdown = !artifactId && ticket?.kind === "text" &&
    ticket.name.toLowerCase().endsWith(".md");
  const markdown = extension === "md" || (sessionMarkdown && !rawText);
  let reason = "";
  if (ticket) {
    if (ticket.kind === "unsupported" && !pdf)
      reason = tr("web.unsupportedFormatDownloadToView");
    else if (
      ticket.kind === "video" &&
      !document.createElement("video").canPlayType(ticket.mime)
    )
      reason = tr("web.thisBrowserDoesNotSupportThisVideoFormatDownload");
    else if (ticket.size > (pdf ? 20 * 1024 ** 2 : previewLimits[ticket.kind]))
      reason = tr("web.fileExceedsThePreviewLimitDownloadToView", {
        p0: formatBytes(pdf ? 20 * 1024 ** 2 : previewLimits[ticket.kind]),
      });
  }
  async function transfer(mode: "preview" | "download") {
    if (!ticket || controller.current) return;
    const abort = new AbortController();
    controller.current = abort;
    setError("");
    setBusy(mode);
    setRawText(false);
    setPreview(undefined);
    setDownload("");
    setPreparing(false);
    setProgress({ received: 0, total: ticket.size, speed: 0 });
    let sink: Awaited<ReturnType<typeof createFileSink>> | undefined;
    try {
      await releaseArtifacts();
      abort.signal.throwIfAborted();
      sink = await createFileSink(ticket.size, mode === "download");
      abort.signal.throwIfAborted();
      await receiveEnvironmentFile(
        ticket,
        sink.write,
        setProgress,
        abort.signal,
      );
      setPreparing(true);
      const blob = await sink.finish(pdf ? "application/pdf" : ticket.mime);
      abort.signal.throwIfAborted();
      if (
        mode === "preview" &&
        pdf &&
        (await blob.slice(0, 5).text()) !== "%PDF-"
      )
        throw new FeedbackError(feedback("web.invalidPdfFormatDownloadToView"));
      if (mode === "preview" && ticket.kind === "text") {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text: string;
        try {
          const encoding =
            bytes[0] === 255 && bytes[1] === 254
              ? "utf-16le"
              : bytes[0] === 254 && bytes[1] === 255
                ? "utf-16be"
                : "utf-8";
          text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
        } catch {
          throw new FeedbackError(
            feedback("web.unsupportedTextEncodingDownloadToView"),
          );
        }
        if (text.includes("\0"))
          throw new FeedbackError(
            feedback("web.fileContainsBinaryContentDownloadToView"),
          );
        abort.signal.throwIfAborted();
        setPreview({ text });
        await sink.cleanup();
        sink = undefined;
      } else {
        const url = URL.createObjectURL(blob);
        urls.current.push(url);
        cleanups.current.push(sink.cleanup);
        sink = undefined;
        if (mode === "preview") setPreview({ url });
        else {
          setDownload(url);
          const anchor = document.createElement("a");
          anchor.href = url;
          anchor.download = ticket.name;
          anchor.rel = "noopener";
          document.body.append(anchor);
          anchor.click();
          anchor.remove();
        }
      }
    } catch (e) {
      if (!abort.signal.aborted)
        setError(
          (e as Error).name === "QuotaExceededError"
            ? feedback(
                "web.insufficientBrowserTemporaryStorageFreeUpSpaceAndRetry",
              )
            : caughtFeedback(e),
        );
      else setError(feedback("web.transferCancelledYouCanTryAgain"));
    } finally {
      await sink?.cleanup();
      if (controller.current === abort) controller.current = null;
      if (!abort.signal.aborted) {
        setBusy("");
        setPreparing(false);
      }
    }
  }
  const cancel = () => {
    controller.current?.abort();
    setBusy("");
    setPreparing(false);
  };
  const close = useCallback(() => {
    controller.current?.abort();
    closeCallback.current();
  }, []);
  const line = classifyFileLink(href).line;
  const textPreview = useRef<HTMLDivElement>(null);
  const previewText = preview?.text;
  const lines = useMemo(() => previewText?.split("\n", 10001), [previewText]);
  const visibleLines = useMemo(() => lines?.slice(0, 10000), [lines]);
  useLayoutEffect(() => {
    const viewport = textPreview.current;
    const selected = viewport?.querySelector(".file-line.selected");
    // 按折行后的真实位置滚动预览框，保持弹窗与页面原有滚动位置。
    if (viewport && selected) {
      viewport.scrollTop +=
        selected.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    }
  }, [line, previewText, markdown]);
  return (
    <Modal
      title={
        preview
          ? tr("web.filePreview")
          : artifactId
            ? tr("web.handoffArtifact")
            : tr("web.environmentFile")
      }
      onClose={close}
    >
      <section className="environment-file">
        {loading && <p role="status">{tr("web.loadingFileInformation")}</p>}
        <ErrorBox error={error} />
        {!loading && !ticket && (
          <Button onClick={() => setRevision((v) => v + 1)}>
            {tr("web.retry")}
          </Button>
        )}
        {ticket && (
          <>
            <h3 className="file-name">{ticket.name}</h3>
            <dl className="file-info">
              <div>
                <dt>{tr("web.size")}</dt>
                <dd>{formatBytes(ticket.size)}</dd>
              </div>
              <div>
                <dt>{tr("web.type")}</dt>
                <dd>{ticket.mime}</dd>
              </div>
              <div>
                <dt>
                  {artifactId
                    ? tr("web.storageLocation")
                    : tr("web.environment")}
                </dt>
                <dd>{environmentName}</dd>
              </div>
              <div>
                <dt>{tr("web.modified")}</dt>
                <dd>
                  {new Date(ticket.modifiedAt).toLocaleString(currentLocale())}
                </dd>
              </div>
            </dl>
            <div className="row file-actions">
              <Button
                variant="primary"
                disabled={!!reason || !!busy}
                onClick={() => void transfer("preview")}
              >
                {tr("web.preview")}
              </Button>
              <Button
                disabled={!!busy}
                onClick={() => void transfer("download")}
              >
                {tr("web.download")}
              </Button>
              {busy && (
                <Button onClick={cancel}>{tr("web.cancelTransfer")}</Button>
              )}
              <Button onClick={close}>{tr("web.close")}</Button>
            </div>
            {reason && <p className="file-warning">{reason}</p>}
            {busy && progress && (
              <div className="file-progress" role="status">
                <div>
                  <span>
                    {preparing
                      ? tr("web.preparing")
                      : busy === "preview"
                        ? tr("web.receivingPreviewFile")
                        : tr("web.receivingDownloadFile")}
                  </span>
                  <strong>
                    {progress.total
                      ? Math.floor((progress.received / progress.total) * 100)
                      : preparing
                        ? 100
                        : 0}
                    %
                  </strong>
                </div>
                <progress
                  aria-label={tr("web.fileTransferProgress")}
                  value={progress.received}
                  max={progress.total || 1}
                />
                <div>
                  <span>
                    {formatBytes(progress.received)} /{" "}
                    {formatBytes(progress.total)}
                  </span>
                  <span>{formatBytes(progress.speed)}/s</span>
                </div>
              </div>
            )}
            {download && (
              <p role="status">
                {tr("web.fileReadyIfItWasNotSavedAutomatically")}
                <a href={download} download={ticket.name}>
                  {tr("web.clickToSaveTheFile")}
                </a>
                。
              </p>
            )}
            {visibleLines && sessionMarkdown && (
              <Sections
                label={tr("web.previewMode")}
                value={rawText ? "raw" : "markdown"}
                onChange={(value) => setRawText(value === "raw")}
                items={[
                  { value: "markdown", label: tr("web.markdownMode") },
                  { value: "raw", label: tr("web.rawText") },
                ]}
              />
            )}
            {lines && lines.length > 10000 && (
                <p className="file-warning">
                  {tr("web.tooManyLinesOnlyTheFirst10000Are")}
                </p>
              )}
            {visibleLines && !html && !markdown && (
              <div
                ref={textPreview}
                className="file-text"
                tabIndex={0}
                aria-label={tr("web.textPreview")}
              >
                {visibleLines.map((text, index) => (
                    <div
                      key={index}
                      className={
                        line === index + 1 ? "file-line selected" : "file-line"
                      }
                    >
                      <span aria-hidden="true">{index + 1}</span>
                      <code>{text || " "}</code>
                    </div>
                  ))}
              </div>
            )}
            {visibleLines && markdown && (
              <div className="artifact-markdown">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  skipHtml
                  components={{
                    pre: MarkdownCodeBlock,
                    a: ({ children }) => <span>{children}</span>,
                    img: () => null,
                  }}
                >
                  {visibleLines.join("\n")}
                </ReactMarkdown>
              </div>
            )}
            {preview?.text !== undefined && html && (
              <iframe
                className="artifact-document"
                title={tr("web.htmlArtifactPreview")}
                sandbox=""
                referrerPolicy="no-referrer"
                srcDoc={safeArtifactHtml(preview.text)}
              />
            )}
            {preview?.url && pdf && (
              <iframe
                className="artifact-document"
                title={tr("web.pdfArtifactPreview")}
                src={preview.url}
              />
            )}
            {preview?.url && ticket.kind === "image" && (
              <img
                className="file-media"
                src={preview.url}
                alt={ticket.name}
                onError={() => {
                  setPreview(undefined);
                  setError(feedback("web.cannotDecodeImageDownloadToView"));
                }}
              />
            )}
            {preview?.url && ticket.kind === "video" && (
              <video
                className="file-media"
                src={preview.url}
                controls
                playsInline
                preload="metadata"
                onError={() => {
                  setPreview(undefined);
                  setError(
                    feedback(
                      "web.thisBrowserDoesNotSupportThisVideoCodecDownload",
                    ),
                  );
                }}
              />
            )}
            {error && ticket && !busy && (
              <Button
                onClick={() => {
                  setPreview(undefined);
                  setRevision((v) => v + 1);
                }}
              >
                {tr("web.reloadFileInformation")}
              </Button>
            )}
          </>
        )}
      </section>
    </Modal>
  );
}

/** 产物 HTML 仅展示静态内容，隔离源并阻止脚本、外部资源与导航。 */
function safeArtifactHtml(text: string) {
  const doc = new DOMParser().parseFromString(text, "text/html");
  doc
    .querySelectorAll("script,iframe,object,embed,meta,link,base,form,svg,math")
    .forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attribute of [...node.attributes]) {
      if (
        /^on/i.test(attribute.name) ||
        ["href", "srcset", "action", "formaction", "srcdoc", "target"].includes(
          attribute.name,
        ) ||
        (attribute.name === "src" &&
          !/^data:image\/(png|jpeg|gif|webp);base64,/i.test(attribute.value))
      )
        node.removeAttribute(attribute.name);
    }
  });
  const policy = doc.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content =
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'";
  doc.head.prepend(policy);
  return "<!doctype html>" + doc.documentElement.outerHTML;
}
