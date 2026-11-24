import { useMemo } from "react";
import type { Components } from "react-markdown";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import json from "highlight.js/lib/languages/json";
import bash from "highlight.js/lib/languages/bash";
import { CodeBlockFrame, markdownCodeContent } from "./ui/index.js";
import { AttachmentDiagram } from "./attachment-diagram.js";

for (const [name, grammar] of Object.entries({
  javascript,
  typescript,
  python,
  json,
  bash,
}))
  hljs.registerLanguage(name, grammar);

/** 只有显式标记的已知语言进入高亮器，复制始终读取原文。 */
export const AttachmentCode: NonNullable<Components["pre"]> = ({
  children,
  node,
}) => {
  const { language, source } = markdownCodeContent(node);
  const name = language.toLowerCase();
  const ascii = ["text", "plaintext", "ascii"].includes(name);
  const highlighted = useMemo(
    () =>
      hljs.getLanguage(name)
        ? hljs.highlight(source, { language: name }).value
        : undefined,
    [name, source],
  );
  return (
    <CodeBlockFrame language={language} source={source}>
      {name === "mermaid" ? (
        <AttachmentDiagram source={source} />
      ) : (
        <pre
          className={ascii ? "attachment-scroll attachment-ascii" : undefined}
          tabIndex={ascii ? 0 : undefined}
        >
          {highlighted !== undefined ? (
            <code dangerouslySetInnerHTML={{ __html: highlighted }} />
          ) : (
            children
          )}
        </pre>
      )}
    </CodeBlockFrame>
  );
};
