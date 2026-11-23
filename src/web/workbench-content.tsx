import { MarkdownCodeBlock, SurfaceButton } from "./ui/index.js";
import { AttachmentLink } from "./session-attachments.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { classifyFileLink } from "../shared/files.js";
import {
  memo,
  createContext,
  useContext,
  type ComponentProps,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  ChevronDown,
  ChevronRight,
  Wrench,
  LoaderCircle,
  CircleCheck,
  CircleAlert,
  CircleSlash,
} from "lucide-react";
import { Button } from "./ui/index.js";

const FileLinkContext = createContext<{
  onFile?: (href: string) => void;
  sessionId?: string;
  online?: boolean;
}>({});
/** 固定链接组件身份，历史轮询和 SSE 更新不会卸载正在读取的缩略图。 */
function MarkdownFileLink({ children, href }: ComponentProps<"a">) {
  const { onFile, sessionId, online } = useContext(FileLinkContext);

  if (!onFile)
    return (
      <a href={href} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    );
  const link = classifyFileLink(href || "");
  if (link.kind === "web")
    return (
      <a href={link.value} target="_blank" rel="noopener noreferrer external">
        {children}
      </a>
    );
  if (
    sessionId &&
    link.kind === "file" &&
    /(?:^|\/)attachments\/relay-[a-f0-9-]{36}\//.test(link.value)
  )
    return (
      <AttachmentLink
        sessionId={sessionId}
        href={href!}
        name={children}
        online={online}
        onOpen={() => onFile(href!)}
      />
    );
  if (link.kind === "file" && onFile)
    return (
      <SurfaceButton kind="file" onClick={() => onFile(href!)}>
        {children}
      </SurfaceButton>
    );
  return <span>{children}</span>;
}

/** 平滑消费累计文本；保留组件身份，使完成事件不会重播或跳过尚未显示的尾部。 */
export const WorkbenchMarkdown = memo(function WorkbenchMarkdown({
  text,
  streaming = false,
  onFile,
  sessionId,
  online,
}: {
  text: string;
  sessionId?: string;
  online?: boolean;
  streaming?: boolean;
  onFile?: (href: string) => void;
}) {
  useLocale();
  const [visible, setVisible] = useState(streaming ? "" : text);
  const shown = useRef(visible);
  useEffect(() => {
    const motion = matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let previous = performance.now();
    let credit = 0;
    // 历史替换、工具轮次重置和减少动态效果直接对齐权威正文。
    if (!text.startsWith(shown.current) || motion.matches) {
      shown.current = text;
      setVisible(text);
      return;
    }
    const remaining = Array.from(
      new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(
        text.slice(shown.current.length),
      ),
      (part) => part.segment,
    );
    let offset = 0;
    const speed = Math.max(0.045, remaining.length / 220);
    const tick = (now: number) => {
      credit += (now - previous) * speed;
      previous = now;
      const count = Math.floor(credit);
      if (count > 0) {
        credit -= count;
        shown.current += remaining.slice(offset, offset + count).join("");
        offset += count;
        setVisible(shown.current);
      }
      if (offset < remaining.length) frame = requestAnimationFrame(tick);
    };
    if (remaining.length) frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [text]);
  return (
    <div className="workbench-markdown">
      <FileLinkContext.Provider value={{ onFile, sessionId, online }}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          skipHtml={!sessionId}
          urlTransform={(url) =>
            onFile
              ? classifyFileLink(url).kind === "blocked"
                ? ""
                : url
              : defaultUrlTransform(url)
          }
          components={{
            a: MarkdownFileLink,
            pre: MarkdownCodeBlock,
            // 本地图片也按用户点击读取，不在渲染 Markdown 时自动访问环境文件。
            img: ({ src, alt }) => {
              if (!onFile) return <img src={src} alt={alt} />;
              const link = classifyFileLink(typeof src === "string" ? src : "");
              if (link.kind === "file" && onFile)
                return (
                  <SurfaceButton
                    kind="file"

                    onClick={() => onFile(src as string)}
                  >
                    {alt || tr("web.viewImage")}
                  </SurfaceButton>
                );
              if (link.kind === "web")
                return (
                  <a
                    href={link.value}
                    target="_blank"
                    rel="noopener noreferrer external"
                  >
                    {alt || tr("web.viewImage")}
                  </a>
                );
              return <span>{alt}</span>;
            },
            table: ({ children }) => (
              <div className="markdown-table" tabIndex={0}>
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {visible}
        </ReactMarkdown>
      </FileLinkContext.Provider>
    </div>
  );
});

/** 每个会话独立管理跟随；观察真实内容尺寸，覆盖逐字输出、图片加载及视口变化。 */
export function WorkbenchMessages({ children }: { children: ReactNode }) {
  useLocale();
  const viewport = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const lastTop = useRef(0);
  const lastHeight = useRef(0);
  const lastClientHeight = useRef(0);
  const touchY = useRef(0);
  const [paused, setPaused] = useState(false);
  const bottom = () => {
    const node = viewport.current;
    if (node) {
      node.scrollTop = node.scrollHeight;
      lastTop.current = node.scrollTop;
      lastHeight.current = node.scrollHeight;
      lastClientHeight.current = node.clientHeight;
    }
  };
  useLayoutEffect(() => {
    bottom();
    const observer = new ResizeObserver(() => {
      if (following.current) bottom();
    });
    observer.observe(content.current!);
    observer.observe(viewport.current!);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="workbench-timeline">
      <div
        className="messages"
        ref={viewport}
        tabIndex={0}
        aria-label={tr("web.workbenchMessageHistory")}
        onScroll={() => {
          const node = viewport.current!;
          // 内容增长可能晚于程序化滚动事件到达，只在真实上滚时暂停跟随。
          if (
            following.current &&
            (node.scrollHeight !== lastHeight.current ||
              node.clientHeight !== lastClientHeight.current)
          ) {
            bottom();
            return;
          }
          if (node.scrollTop < lastTop.current - 1) following.current = false;
          else if (node.scrollHeight - node.scrollTop - node.clientHeight <= 24)
            following.current = true;
          lastTop.current = node.scrollTop;
          lastHeight.current = node.scrollHeight;
          lastClientHeight.current = node.clientHeight;
          setPaused(!following.current);
        }}
        onTouchStart={(event) => {
          touchY.current = event.touches[0]?.clientY ?? 0;
        }}
        onTouchMove={(event) => {
          const y = event.touches[0]?.clientY ?? touchY.current;
          if (y > touchY.current + 2) {
            following.current = false;
            setPaused(true);
          }
          touchY.current = y;
        }}
        onKeyDown={(event) => {
          if (["ArrowUp", "PageUp", "Home"].includes(event.key)) {
            following.current = false;
            setPaused(true);
          }
        }}
        onWheel={(event) => {
          if (event.deltaY < 0) {
            following.current = false;
            setPaused(true);
          }
        }}
      >
        <div className="workbench-message-content" ref={content}>
          {children}
        </div>
      </div>
      {paused && (
        <Button
          placement="jump-bottom"
          shape="icon"

          aria-label={tr("web.jumpToLatestMessage")}
          title={tr("web.jumpToLatestMessage")}
          onClick={() => {
            following.current = true;
            setPaused(false);
            bottom();
          }}
        >
          <ArrowDown aria-hidden="true" />
        </Button>
      )}
    </div>
  );
}

/** 键盘弹出时使用可视视口高度；卸载后还原，避免影响其他页面。 */
export function useWorkbenchViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => {
      document.documentElement.style.setProperty(
        "--workbench-height",
        `${viewport?.height ?? innerHeight}px`,
      );
      document.documentElement.style.setProperty(
        "--workbench-top",
        `${viewport?.offsetTop ?? 0}px`,
      );
    };
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
      document.documentElement.style.removeProperty("--workbench-height");
      document.documentElement.style.removeProperty("--workbench-top");
    };
  }, []);
}

/** 相邻工具组成可折叠活动段；后续文本出现时切换组件身份，清除此前展开状态。 */
export function WorkbenchReply({ message }: { message: any }) {
  useLocale();
  if (!message.blocks)
    return (
      <WorkbenchMarkdown
        text={message.text || ""}
        streaming={message.streaming}
      />
    );
  const groups: any[] = [];
  for (const block of message.blocks) {
    if (block.type === "text") groups.push(block);
    else {
      const previous = groups.at(-1);
      if (previous?.type === "activities") previous.blocks.push(block);
      else groups.push({ type: "activities", id: block.id, blocks: [block] });
    }
  }
  return groups.map((group, index) =>
    group.type === "text" ? (
      <WorkbenchMarkdown
        key={group.id}
        text={group.text}
        streaming={group.streaming}
      />
    ) : (
      <WorkbenchActivityGroup
        key={
          group.id +
          ":" +
          groups
            .slice(index + 1)
            .some((g) => g.type === "text" && g.text.length > 0)
        }
        blocks={group.blocks}
        followedByText={groups
          .slice(index + 1)
          .some((g) => g.type === "text" && g.text.length > 0)}
      />
    ),
  );
}

/** 工具详情按需展开，失败仅保留摘要提示，不阻止下一段文本收起活动区。 */
export function WorkbenchActivityGroup({
  blocks,
  followedByText,
  nativeNames = false,
}: {
  blocks: any[];
  followedByText: boolean;
  nativeNames?: boolean;
}) {
  useLocale();
  const [override, setOverride] = useState<boolean>();
  const active = blocks.some((block) =>
    ["running", "approval"].includes(block.status),
  );
  const failures = blocks.filter((block) => block.status === "failed").length;
  const expanded = override ?? (!followedByText && (active || failures > 0));
  const labels: Record<string, string> = {
    running: tr("web.running"),
    approval: tr("web.pendingApproval"),
    completed: tr("web.done"),
    failed: tr("web.failed"),
    denied: tr("web.rejected"),
    cancelled: tr("web.cancelled"),
    interrupted: tr("web.interruptedAlternative617"),
  };
  const names: Record<string, string> = {
    platform_read: tr("web.readPlatformInformation"),
    workbench_prompt_read: tr("web.readWorkbenchInstructions"),
    workbench_prompt_write: tr("web.updateWorkbenchInstructions"),
    session_result: tr("web.readEnvironmentExecutionResult"),
    session_send: tr("web.sendEnvironmentSession"),
    board_write: tr("web.manageBoards"),
    create_work_item: tr("web.createWorkItem"),
    environment_agent_write: tr("web.manageEnvironmentAgents"),
  };
  const summary = tr("web.activities", {
    p0: blocks.length,
    p1: failures
      ? tr("web.failedAlternative626", { p0: failures })
      : active
        ? tr("web.processingAlternative627")
        : "",
  });
  return (
    <section className="workbench-activity-group">
      <SurfaceButton
        kind="activity"

        aria-expanded={expanded}
        onClick={() => setOverride(!expanded)}
      >
        {expanded ? (
          <ChevronDown aria-hidden="true" />
        ) : (
          <ChevronRight aria-hidden="true" />
        )}
        <Wrench aria-hidden="true" />
        <span>{summary}</span>
      </SurfaceButton>
      <div className="workbench-activity-rail" hidden={!expanded}>
        {blocks.map((block) => (
          <details className="workbench-activity" key={block.id}>
            <summary>
              {block.status === "running" ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : block.status === "failed" ? (
                <CircleAlert aria-hidden="true" />
              ) : ["cancelled", "denied"].includes(block.status) ? (
                <CircleSlash aria-hidden="true" />
              ) : block.status === "completed" ? (
                <CircleCheck aria-hidden="true" />
              ) : (
                <Wrench aria-hidden="true" />
              )}
              <span>
                {nativeNames ? block.name : names[block.name] || block.name}
              </span>
              <small>{labels[block.status] || block.status}</small>
            </summary>
            <div className="workbench-activity-detail">
              <small>{block.name}</small>
              {block.arguments !== undefined && (
                <>
                  <h4>{tr("web.callArguments")}</h4>
                  <pre>{prettyActivity(block.arguments)}</pre>
                </>
              )}
              {block.raw !== undefined && (
                <>
                  <h4>{tr("web.rawData")}</h4>
                  <pre>{prettyActivity(block.raw)}</pre>
                </>
              )}
              {block.output != null && (
                <>
                  <h4>{tr("web.executionResult")}</h4>
                  <pre>{prettyActivity(block.output)}</pre>
                </>
              )}
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

/** 格式化结构化输出，不将工具结果作为 HTML 执行。 */
function prettyActivity(value: unknown) {
  if (typeof value !== "string") return JSON.stringify(value, null, 2);
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}
