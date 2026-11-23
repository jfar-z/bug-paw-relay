import { translate, type Locale, type MessageParams } from "./i18n.js";

export interface DisplayNotice {
  path: (string | number)[];
  start: number;
  original: string;
  messageKey: string;
  messageParams: MessageParams;
}

/** 只给本次投影生成的提示附加位置元数据，不识别或改写用户输入的相似句子。 */
export function sessionProjection<T>(value: T): {
  value: T;
  notices: DisplayNotice[];
} {
  const notices: DisplayNotice[] = [];
  const notice = (
    path: (string | number)[],
    start: number,
    messageKey: string,
    messageParams: MessageParams = {},
  ) => {
    const original = translate("zh-CN", messageKey, messageParams);
    notices.push({ path, start, original, messageKey, messageParams });
    return original;
  };
  const visit = (
    input: any,
    depth: number,
    path: (string | number)[],
    binary = false,
  ): any => {
    if (typeof input === "string") {
      if (binary && !/^\[二进制内容已省略，\d+ 字符\]$/.test(input))
        return notice(path, 0, "display.binary", { count: input.length });
      // 短于长编码阈值且不含 data: 前缀时，两类编码均不可能命中，也无需截断。
      if (input.length < 1024 && !input.includes("data:")) return input;
      let text = input.replace(
        /data:[^\s;,'"<>]*;base64,[A-Za-z0-9+/=_-]+|[A-Za-z0-9+/_-]{1024,}={0,2}/g,
        (match, offset: number) => {
          // 替换后的偏移按已生成提示的长度差修正。
          const shift = notices
            .filter((item) => item.path === path)
            .reduce(
              (sum, item) => sum + Number(item.messageParams.removed || 0),
              0,
            );
          const key = match.startsWith("data:")
            ? "display.embedded"
            : "display.encoded";
          const result = notice(path, offset - shift, key);
          notices.at(-1)!.messageParams.removed = match.length - result.length;
          return result;
        },
      );
      if (
        text.length > 32768 &&
        !(
          text.length < 33000 &&
          /\n\[展示内容已截断，原文 \d+ 字符；完整记录保留在环境端\]$/.test(
            text,
          )
        )
      )
        text =
          text.slice(0, 32768) +
          notice(path, 32768, "display.truncated", { count: text.length });
      return text;
    }
    if (input === null || typeof input !== "object") return input;
    if (depth >= 24) return notice(path, 0, "display.depth");
    if (Array.isArray(input)) {
      const output = input
        .slice(0, 2000)
        .map((entry, index) =>
          visit(entry, depth + 1, [...path, index], binary),
        );
      if (input.length > 2000)
        output.push(notice([...path, 2000], 0, "display.entries"));
      return output;
    }
    const encoded = input.type === "base64" || input.encoding === "base64";
    const media =
      /image|audio|video|document/i.test(String(input.type || "")) ||
      typeof input.mimeType === "string" ||
      typeof input.media_type === "string";
    return Object.fromEntries(
      Object.entries(input).map(([key, entry]) => [
        key,
        visit(
          entry,
          depth + 1,
          [...path, key],
          /^(?:base64|b64_json|bytes)$/i.test(key) ||
            ((encoded || media) && /^(?:data|image|audio|video)$/i.test(key)),
        ),
      ]),
    );
  };
  const projected = visit(value, 0, []);
  for (const item of notices) delete item.messageParams.removed;
  return { value: projected, notices };
}
/** 展示副本限制二进制和字段大小，不修改环境权威历史。 */
export function sessionDisplay<T>(value: T): T {
  return sessionProjection(value).value;
}

/** 只翻译显式标记且仍匹配的产品提示，历史纯文本和用户正文逐字保留。 */
export function localizeProjection<T>(
  value: T,
  notices: DisplayNotice[] | undefined,
  locale: Locale,
): T {
  if (!Array.isArray(notices) || !notices.length) return value;
  let result: any = structuredClone(value);
  for (const item of [...notices].sort((a, b) => b.start - a.start)) {
    if (
      !Array.isArray(item.path) ||
      item.path.some((part) =>
        ["__proto__", "constructor", "prototype"].includes(String(part)),
      ) ||
      !item.messageKey.startsWith("display.")
    )
      continue;
    let parent = result;
    for (const part of item.path.slice(0, -1))
      parent = parent && Object.hasOwn(parent, part) ? parent[part] : undefined;
    const key = item.path.at(-1);
    const text =
      key === undefined
        ? result
        : parent && Object.hasOwn(parent, key)
          ? parent[key]
          : undefined;
    if (
      typeof text !== "string" ||
      text.slice(item.start, item.start + item.original.length) !==
        item.original
    )
      continue;
    const localized =
      text.slice(0, item.start) +
      translate(locale, item.messageKey, item.messageParams) +
      text.slice(item.start + item.original.length);
    if (key === undefined) result = localized;
    else parent[key] = localized;
  }
  return result;
}
