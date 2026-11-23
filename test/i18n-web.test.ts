import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import {
  createBrowserLocale,
  browserLocaleHelpers,
} from "../src/shared/browser-locale.js";
import { messages } from "../src/shared/i18n.js";

/** 浏览器存储限制和系统变化不能使语言状态失去响应。 */
test("浏览器语言策略、存储失败与跨标签页同步", () => {
  const events = new EventTarget();
  const values = new Map<string, string>();
  let blocked = false;
  const browser = Object.assign(events, {
    document: { documentElement: { lang: "" } },
    navigator: { languages: ["zh-TW"], language: "zh-TW" },
    localStorage: {
      getItem(key: string) {
        return values.get(key) || null;
      },
      setItem(key: string, value: string) {
        if (blocked) throw Error("blocked");
        values.set(key, value);
      },
    },
  });
  const state = createBrowserLocale(browser as any, browserLocaleHelpers);
  assert.equal(state.preference, "auto");
  assert.equal(state.locale, "zh-CN");
  assert.equal(state.systemLocale, "zh-CN");
  assert.equal(values.size, 0);
  state.set("en");
  assert.equal(values.get("relay-locale-preference"), "en");
  browser.navigator.languages = ["zh-CN"];
  events.dispatchEvent(new Event("languagechange"));
  assert.equal(state.locale, "en");
  let notifications = 0;
  const unsubscribe = state.subscribe(() => notifications++);
  for (const [languages, expected] of [
    [["en-GB"], "en"],
    [["fr-FR", "zh-TW", "en-US"], "zh-CN"],
    [["fr-FR"], "en"],
    [[], "en"],
  ] as const) {
    browser.navigator.languages = [...languages];
    events.dispatchEvent(new Event("languagechange"));
    assert.equal(state.systemLocale, expected);
    assert.equal(state.locale, "en");
    assert.equal(state.preference, "en");
    assert.equal(browser.document.documentElement.lang, "en");
    assert.equal(values.get("relay-locale-preference"), "en");
  }
  assert.equal(notifications, 4);
  unsubscribe();
  state.set("auto");
  browser.navigator.languages = ["fr-FR", "en-US"];
  events.dispatchEvent(new Event("languagechange"));
  assert.equal(state.locale, "en");
  blocked = true;
  state.set("zh-CN");
  assert.equal(state.locale, "zh-CN");
  assert.equal(state.temporary, true);
  events.dispatchEvent(
    Object.assign(new Event("storage"), {
      key: "relay-locale-preference",
      newValue: "en",
    }),
  );
  assert.equal(state.locale, "en");
  assert.equal(state.temporary, false);
  events.dispatchEvent(
    Object.assign(new Event("storage"), { key: null, newValue: null }),
  );
  assert.equal(state.preference, "auto");
});

/** 扫描产品可见字面量和显式资源调用；中文注释、语言自称为明确豁免。 */
test("Web 与连接器可见文案必须使用已登记资源键", () => {
  for (const file of readdirSync("src/web", { recursive: true, encoding: "utf8" }).filter((file) =>
    /\.tsx?$/.test(file),
  )) {
    const source = readFileSync("src/web/" + file, "utf8");
    for (const match of source.matchAll(/\b(?:tr|feedback)\("([^"\n]+)"/g)) {
      assert.ok(Object.hasOwn(messages, match[1]), file + ": " + match[1]);
    }
    const code = source
      .split("\n")
      .filter((line) => !/^\s*(?:\/\/|\/\*|\*|\*\/)/.test(line))
      .join("\n");
    for (const match of code.matchAll(
      /(?:"([^"\n]*[\p{Script=Han}][^"\n]*)"|'([^'\n]*[\p{Script=Han}][^'\n]*)')/gu,
    )) {
      const value = match[1] || match[2];
      assert.ok(
        file === "language-menu.tsx" && value === "简体中文",
        file + ": " + value,
      );
    }
    assert.doesNotMatch(code, />[^<>{}\n]*[\p{Script=Han}][^<>{}\n]*</u, file);
  }
  const consoleSource = readFileSync("src/connector/console-ui.ts", "utf8");
  for (const match of consoleSource.matchAll(
    /(?:ct\(['"]|data-i18n(?:-[a-z-]+)?=")([^"']+)/g,
  )) {
    assert.ok(Object.hasOwn(messages, match[1]), "console: " + match[1]);
  }
  assert.ok(!consoleSource.includes("location.reload()" + ";localeState"));
});
