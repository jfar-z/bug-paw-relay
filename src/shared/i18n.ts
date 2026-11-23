import { messages } from "./i18n-catalog.js";

export type Locale = "zh-CN" | "en";
export type LocalePreference = Locale | "auto";
export type MessageKey = keyof typeof messages;
export type MessageParams = Record<string, string | number | boolean>;
export interface MessageDescriptor {
  messageKey: MessageKey;
  messageParams: MessageParams;
}
export const confirmedLocaleStorageKey = "relay-confirmed-locale";

/** 服务端 Web 离线时仅采用上次确认的有效语言。 */
export function readConfirmedLocale(browser: Window, key: string): Locale | undefined {
  try {
    const value = browser.localStorage.getItem(key);
    return value === "zh-CN" || value === "en" ? value : undefined;
  } catch {
    return undefined;
  }
}

export const localeStorageKey = "relay-locale-preference";
export { messages };

/** 浏览器列表、POSIX 与 Windows locale 共用归一化；不修改系统语言。 */
export function normalizeLocale(value: unknown): Locale | undefined {
  if (typeof value !== "string") return undefined;
  const tag = value.trim().split(/[.@]/)[0].replaceAll("_", "-").toLowerCase();
  if (tag === "c" || tag === "posix") return "en";
  if (/^zh(?:-[a-z0-9]+)*$/.test(tag)) return "zh-CN";
  if (/^en(?:-[a-z0-9]+)*$/.test(tag)) return "en";
  return undefined;
}
export function preference(value: unknown): LocalePreference {
  return value === "zh-CN" || value === "en" ? value : "auto";
}
export function resolveLocale(
  value: LocalePreference,
  system: readonly string[],
): Locale {
  if (value !== "auto") return value;
  return (
    system.map(normalizeLocale).find((locale) => locale !== undefined) || "en"
  );
}
/** 按 q 值排序且排除 q=0；不支持或畸形项不能抢占支持项。 */
export function negotiateLocale(header: unknown): Locale {
  if (typeof header !== "string") return "en";
  const candidates = header.split(",").map((part, index) => {
    const [tag, ...parameters] = part.trim().split(";");
    const qPart = parameters.find((p) => /^\s*q\s*=/i.test(p));
    const raw = qPart?.split("=")[1]?.trim();
    const q =
      raw === undefined
        ? 1
        : /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(raw)
          ? Number(raw)
          : 0;
    return { locale: normalizeLocale(tag), q, index };
  });
  return (
    candidates
      .filter((c) => c.locale && c.q > 0)
      .sort((a, b) => b.q - a.q || a.index - b.index)[0]?.locale || "en"
  );
}
export function isMessageKey(key: unknown): key is MessageKey {
  return typeof key === "string" && Object.hasOwn(messages, key);
}
/** 未识别的键只展示通用失败，不泄露内部键或插值对象。 */
export function translate(
  locale: Locale,
  key: string,
  params: MessageParams = {},
): string {
  const template = isMessageKey(key)
    ? messages[key][locale] || messages[key].en
    : messages["common.failure"][locale];
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : "",
  );
}
type ParameterNames<S extends string> =
  S extends `${string}{${infer Name}}${infer Rest}`
    ? Name | ParameterNames<Rest>
    : never;
export type ParamsFor<K extends MessageKey> = [
  ParameterNames<(typeof messages)[K]["en"]>,
] extends [never]
  ? Record<string, never>
  : {
      [P in ParameterNames<(typeof messages)[K]["en"]>]: P extends
        "count" | "status"
        ? number
        : string | number | boolean;
    };
/** 参数名从英文资源推导，双语一致性由发行测试验证。 */
export function message<K extends MessageKey>(
  messageKey: K,
  messageParams?: ParamsFor<K>,
): { messageKey: K; messageParams: ParamsFor<K> } {
  return { messageKey, messageParams: messageParams || ({} as ParamsFor<K>) };
}
/** 面向页面的日期数字格式化不改变原始时间点和协议值。 */
export function formatNumber(
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
) {
  return new Intl.NumberFormat(locale, options).format(value);
}
export function formatDate(
  locale: Locale,
  value: Date | number,
  options?: Intl.DateTimeFormatOptions,
) {
  return new Intl.DateTimeFormat(locale, options).format(value);
}
