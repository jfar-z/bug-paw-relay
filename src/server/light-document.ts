import { readFileSync } from "node:fs";

// 提供经典脚本正文，本地复现可直接放在应用脚本之前。
export const storageScript = readFileSync(
  new URL("./light-storage.js", import.meta.url),
  "utf8",
).replace("export function installLightStorage", "function installLightStorage");
const loader = readFileSync(
  new URL("./light-loader.js", import.meta.url),
  "utf8",
);
// 发布者的 HTML 在不透明沙箱中执行。先在当前分区完成授权，再交给浏览器解析静态页面。
type DocumentInput = {
  base: string;
  entry: string;
  prefix: string;
  ticket: string;
  mainOrigin: string;
  channelId: string;
  html: string;
};

export function renderLightDocument(input: DocumentInput) {
  const payload = JSON.stringify(input).replaceAll("<", "\\u003c");
  return (
    '<!doctype html><meta charset="utf-8"><script id="light-input" type="application/json">' +
    payload +
    '</script><script type="module">' +
    storageScript + "\n" + loader +
    "</script>"
  );
}
