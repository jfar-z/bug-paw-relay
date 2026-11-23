import {
  confirmedLocaleStorageKey,
  messages,
  readConfirmedLocale,
} from "./i18n.js";

/** 离线页和同源脚本随构建预缓存，业务 API 仍走网络。 */
export const offlineDocument = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BugPaw Relay</title><style>body{font:16px sans-serif;color:#283444;background:#f7f6f2;text-align:center;padding:12vh 24px}img{width:90px}button{padding:12px 20px;min-height:44px;background:#283444;color:#fff;border:0;border-radius:8px;cursor:pointer}button:focus-visible{outline:3px solid #587b3e;outline-offset:3px}</style><img src="/assets/bugpaw-app-icon-brown-paw.png" alt="BugPaw Relay"><h1 id="title"></h1><p id="note"></p><button id="retry"></button><script src="/offline-i18n.js"></script></html>`;

const offlineMessages = {
  title: messages["offline.title"],
  note: messages["offline.note"],
  retry: messages["offline.retry"],
};

export const offlineScript = `
const readConfirmedLocale = ${readConfirmedLocale.toString()};
const locale = readConfirmedLocale(window, ${JSON.stringify(confirmedLocaleStorageKey)}) ?? "en";
document.documentElement.lang = locale;
const messages = ${JSON.stringify(offlineMessages).replaceAll("<", "\\u003c")};
for (const [id, message] of Object.entries(messages)) {
  document.getElementById(id).textContent = message[locale];
}
const retry = () => location.reload();
document.getElementById('retry').onclick = retry;
window.addEventListener('online', retry);
`;
