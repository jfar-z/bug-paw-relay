import {
  localeStorageKey,
  preference,
  resolveLocale,
  translate,
  type LocalePreference,
} from "./i18n.js";

/** 可序列化给独立控制台的语言状态；依赖显式传入，不能读取 Node 配置。 */
export function createBrowserLocale(
  browser: Window & typeof globalThis,
  helpers: {
    preference: typeof preference;
    resolveLocale: typeof resolveLocale;
    translate: typeof translate;
    storageKey: string;
  },
) {
  let selected: LocalePreference = "auto";
  let temporary = false;
  try {
    selected = helpers.preference(
      browser.localStorage.getItem(helpers.storageKey),
    );
  } catch {
    /* 存储不可读时持续跟随系统。 */
  }
  // 系统候选独立于手动偏好，供各入口展示跟随系统的实际目标。
  let systemLocale = helpers.resolveLocale(
    "auto",
    browser.navigator.languages || [browser.navigator.language],
  );
  let locale = helpers.resolveLocale(selected, [systemLocale]);
  const listeners = new Set<() => void>();
  let version = 0;
  const update = () => {
    systemLocale = helpers.resolveLocale(
      "auto",
      browser.navigator.languages || [browser.navigator.language],
    );
    locale = helpers.resolveLocale(selected, [systemLocale]);
    browser.document.documentElement.lang = locale;
    version++;
    listeners.forEach((notify) => notify());
  };
  // 手动模式也通知菜单更新系统候选，但不改变界面语言或已存偏好。
  browser.addEventListener("languagechange", update);
  browser.addEventListener("storage", (event) => {
    if (event.key === helpers.storageKey || event.key === null) {
      selected = helpers.preference(event.newValue);
      temporary = false;
      update();
    }
  });
  update();
  return {
    get locale() {
      return locale;
    },
    get systemLocale() {
      return systemLocale;
    },
    get preference() {
      return selected;
    },
    get temporary() {
      return temporary;
    },
    snapshot: () => version,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    },
    set(value: LocalePreference) {
      selected = helpers.preference(value);
      temporary = false;
      try {
        browser.localStorage.setItem(helpers.storageKey, selected);
      } catch {
        temporary = true;
      }
      update();
    },
    t: (key: string, params: Record<string, string | number | boolean> = {}) =>
      helpers.translate(locale, key, params),
  };
}
export const browserLocaleHelpers = {
  preference,
  resolveLocale,
  translate,
  storageKey: localeStorageKey,
};
