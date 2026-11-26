import { memo, type ComponentProps } from "react";
import katex from "katex";
import type { Construct, State } from "micromark-util-types";
import type { Extension } from "mdast-util-from-markdown";
import type { Plugin } from "unified";
import type {} from "remark-parse";

declare module "micromark-util-types" {
  interface TokenTypeMap {
    sessionMath: "sessionMath";
    mathDelimiter: "mathDelimiter";
    mathOpening: "mathOpening";
  }
}

const dollar = 36;
const slash = 92;
const space = (code: number | null) => code !== null && code <= 32;

/** 在 Markdown 的正文分词阶段匹配，代码、链接目标和 HTML 仍由原有语法消费。 */
const formula: Construct = {
  tokenize(effects, ok, nok) {
    let marker: number;
    let closing: number;
    let display = false;
    let previousSpace = true;
    let numericPrefix = false;
    const start: State = (code) => {
      marker = code!;
      effects.enter("sessionMath");
      effects.consume(marker);
      return opening;
    };
    const opening: State = (code) => {
      if (marker === slash) {
        if (code !== 40 && code !== 91) return nok(code);
        display = code === 91;
        closing = display ? 93 : 41;
      } else {
        closing = dollar;
        if (code !== dollar) {
          numericPrefix = code !== null && code >= 48 && code <= 57;
          return space(code) ? nok(code) : body(code);
        }
        display = true;
      }
      effects.consume(code);
      return body;
    };
    const body: State = (code) => {
      if (code === null || code === 96 || (!display && code < -2))
        return nok(code);
      if (numericPrefix && !(code >= 48 && code <= 57) && code !== 46) {
        // 金额紧邻正文标点时，不能借用下一条公式的开头作为结束符。
        if (/[，。；：！？、]/u.test(String.fromCodePoint(Math.max(0, code))))
          return nok(code);
        numericPrefix = false;
      }
      if (code < -2) {
        effects.enter("lineEnding");
        effects.consume(code);
        effects.exit("lineEnding");
        return body;
      }
      if (code === slash) {
        effects.consume(code);
        return escaped;
      }
      if (marker === dollar && code === dollar) {
        if (!display && previousSpace) return nok(code);
        effects.enter("mathDelimiter");
        effects.consume(code);
        return display ? secondDollar : afterDollar;
      }
      previousSpace = space(code);
      effects.consume(code);
      return body;
    };
    const escaped: State = (code) => {
      if (code === null || code < -2) return nok(code);
      // 未闭合的起始符不能吞掉下一条完整公式。
      if (marker === slash && (code === 40 || code === 91)) return nok(code);
      const isClosing = marker === slash && code === closing;
      if (isClosing) effects.enter("mathDelimiter");
      effects.consume(code);
      previousSpace = false;
      return isClosing ? finish : body;
    };
    const afterDollar: State = (code) =>
      code !== null && code >= 48 && code <= 57 ? nok(code) : finish(code);
    const secondDollar: State = (code) => {
      if (code !== dollar) return nok(code);
      effects.consume(code);
      return finish;
    };
    const finish: State = (code) => {
      effects.exit("mathDelimiter");
      effects.exit("sessionMath");
      return ok(code);
    };
    return start;
  },
};

/** 未闭合时保留原始起始符，避免普通 Markdown 转义移除反斜杠。 */
const literalOpening: Construct = {
  tokenize(effects, ok, nok) {
    return (code) => {
      effects.enter("mathOpening");
      effects.consume(code!);
      return (next) => {
        if (code === slash ? next !== 40 && next !== 91 : next !== dollar)
          return nok(next);
        effects.consume(next);
        effects.exit("mathOpening");
        return ok;
      };
    };
  },
};

const syntax = {
  text: {
    [slash]: [formula, literalOpening],
    [dollar]: [formula, literalOpening],
  },
};
const nodes: Extension = {
  enter: {
    sessionMath(token) {
      const source = this.sliceSerialize(token);
      this.enter(
        {
          type: "inlineCode",
          value: source,
          data: {
            hName: "span",
            hProperties: { className: ["session-math"] },
            hChildren: [{ type: "text", value: source }],
          },
        },
        token,
      );
    },
    mathOpening(token) {
      this.enter({ type: "text", value: this.sliceSerialize(token) }, token);
    },
  },
  exit: {
    sessionMath(token) {
      this.exit(token);
    },
    mathOpening(token) {
      this.exit(token);
    },
  },
};

export const remarkSessionMath: Plugin = function () {
  const data = this.data();
  (data.micromarkExtensions ??= []).push(syntax);
  (data.fromMarkdownExtensions ??= []).push(nodes);
};

/** 仅插入 KaTeX 在禁用可信命令时生成的标记，失败时由 React 转义原文。 */
export const MathSpan = memo(function MathSpan({
  children,
  className,
}: ComponentProps<"span">) {
  if (className !== "session-math" || typeof children !== "string")
    return <span>{children}</span>;
  const displayMode = children.startsWith("$$") || children.startsWith("\\[");
  const width = children.startsWith("$") && !displayMode ? 1 : 2;
  try {
    const html = katex.renderToString(children.slice(width, -width), {
      displayMode,
      throwOnError: true,
      trust: false,
      maxSize: 20,
      strict: "error",
    });
    return (
      <span
        className={displayMode ? "session-math-display" : "session-math-inline"}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  } catch {
    return <span>{children}</span>;
  }
});
