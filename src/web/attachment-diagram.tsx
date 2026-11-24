import { useEffect, useState } from "react";
import mermaidUrl from "mermaid/dist/mermaid.min.js?url";
import rendererUrl from "./mermaid-frame.js?url&no-inline";
import { t } from "./locale.js";

type Drawing = { svg: string; width: number; height: number };
let activeFrame:
  | { element: HTMLIFrameElement; ready: Promise<void>; users: number }
  | undefined;

/** 同批图块共享隔离的排版环境，完成或关闭预览后释放。 */
function acquireFrame() {
  if (!activeFrame) {
    const element = document.createElement("iframe");
    element.className = "attachment-render-frame";
    element.tabIndex = -1;
    element.setAttribute("aria-hidden", "true");
    element.sandbox.add("allow-scripts");
    const ready = new Promise<void>((resolve) => {
      element.onload = () => resolve();
    });
    const scripts = [mermaidUrl, rendererUrl].map(
      (url) => new URL(url, location.href).href,
    );
    const policy = `default-src 'none'; script-src ${scripts.join(" ")}; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'`;
    element.srcdoc =
      `<!doctype html><meta http-equiv="Content-Security-Policy" content="${policy}">` +
      scripts.map((url) => `<script defer src="${url}"></script>`).join("");
    activeFrame = { element, ready, users: 0 };
    document.body.append(element);
  }
  activeFrame.users++;
  return activeFrame;
}

/** 以静态图片展示图形，图内链接和文档样式不能操作宿主页面。 */
export function AttachmentDiagram({ source }: { source: string }) {
  const [drawing, setDrawing] = useState<Drawing | null>();
  useEffect(() => {
    setDrawing(undefined);
    const frame = acquireFrame();
    const channel = new MessageChannel();
    let finished = false;
    function release() {
      if (finished) return;
      finished = true;
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      if (--frame.users === 0) {
        frame.element.remove();
        activeFrame = undefined;
      }
    }
    function complete(result: Drawing | null) {
      if (!finished) setDrawing(result);
      release();
    }
    const timeout = setTimeout(() => complete(null), 30000);
    channel.port1.onmessage = (event) => complete(event.data);
    void frame.ready.then(() => {
      if (!finished)
        frame.element.contentWindow?.postMessage(
          { source, id: "diagram-" + crypto.randomUUID() },
          "*",
          [channel.port2],
        );
    });
    return release;
  }, [source]);
  if (!drawing)
    return (
      <>
        {drawing === null && (
          <p className="file-warning">{t("web.diagramUnavailable")}</p>
        )}
        <pre>
          <code>{source}</code>
        </pre>
      </>
    );
  return (
    <div className="attachment-scroll attachment-diagram" tabIndex={0}>
      <img
        src={
          "data:image/svg+xml;charset=utf-8," + encodeURIComponent(drawing.svg)
        }
        width={Math.ceil(drawing.width)}
        height={Math.ceil(drawing.height)}
        alt={source.trim()}
        onError={() => setDrawing(null)}
      />
    </div>
  );
}
