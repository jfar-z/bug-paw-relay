import { useSyncExternalStore } from "react";
import {
  confirmedLocaleStorageKey,
  readConfirmedLocale,
  translate,
  type Locale,
  type LocalePreference,
  type MessageParams,
} from "../shared/i18n.js";
import { localizeError } from "../shared/i18n-errors.js";

export interface LanguageSettings {
  preference: LocalePreference;
  serverLocale: Locale;
  locale: Locale;
}

/** 单一语言状态通知现有组件重渲染，不重挂载页面和表单。 */
function createServerLocale(browser: Window) {
  let confirmed = readConfirmedLocale(browser, confirmedLocaleStorageKey);
  const fallback = confirmed ?? "en";
  let settings: LanguageSettings = {
    preference: "auto",
    serverLocale: fallback,
    locale: fallback,
  };
  let preview: LocalePreference | undefined;
  let version = 0;
  const listeners = new Set<() => void>();
  const locale = () => (preview === "auto" ? settings.serverLocale : preview ?? settings.locale);
  const update = () => {
    browser.document.documentElement.lang = locale();
    version++;
    listeners.forEach((notify) => notify());
  };
  update();
  return {
    get locale() {
      return locale();
    },
    get serverLocale() {
      return settings.serverLocale;
    },
    get preference() {
      return preview ?? settings.preference;
    },
    snapshot: () => version,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    anonymous(serverLocale: Locale) {
      // 匿名响应只提供进程默认语言，不能覆盖最近一次认证确认的缓存。
      settings = { preference: confirmed ?? "auto", serverLocale, locale: confirmed ?? serverLocale };
      update();
    },
    confirm(value: LanguageSettings) {
      settings = value;
      confirmed = value.locale;
      preview = undefined;
      try {
        browser.localStorage.setItem(confirmedLocaleStorageKey, value.locale);
      } catch {
        // 存储不可用时，已确认的语言仍在当前页面生效。
      }
      update();
    },
    preview(value: LocalePreference) {
      preview = value;
      update();
    },
  };
}

export const localeState =
  typeof window === "undefined" ? undefined : createServerLocale(window);
export const currentLocale = () => localeState?.locale || "en";
export const t = (key: string, params?: MessageParams) =>
  translate(currentLocale(), key, params);
export function useLocale() {
  useSyncExternalStore(
    localeState?.subscribe || (() => () => {}),
    localeState?.snapshot || (() => 0),
    () => 0,
  );
  return currentLocale();
}
/** 错误保留消息描述符；语言在展示时解析，避免响应期间切换后串语言。 */
export function displayError(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof FeedbackError) return displayError(error.details);
  if (typeof error === "object" && error && "messageKey" in error) {
    const value = error as {
      messageKey: string;
      messageParams?: MessageParams;
      context?: string;
    };
    return (
      t(value.messageKey, value.messageParams) +
      (value.context ? " (" + value.context + ")" : "")
    );
  }
  return localizeError(currentLocale(), error);
}
export function localeDate(value: string | number | Date) {
  return new Date(value).toLocaleString(currentLocale());
}

export type UiFeedback =
  | string
  | { messageKey: string; messageParams?: MessageParams; context?: string };
/** 本地提示保存资源键与参数，异步结束及语言切换后都以展示时语言渲染。 */
export const feedback = (
  messageKey: string,
  messageParams?: MessageParams,
): UiFeedback => ({ messageKey, messageParams });
export class FeedbackError extends Error {
  constructor(public details: UiFeedback) {
    super(displayError(details));
  }
}
export function caughtFeedback(error: unknown): UiFeedback {
  if (error instanceof FeedbackError) return error.details;
  if (typeof error === "object" && error && "messageKey" in error)
    return error as UiFeedback;
  return feedback("common.failure");
}
