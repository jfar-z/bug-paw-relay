import { readFileSync, writeFileSync } from "node:fs";
/** 从唯一 CSS 源生成控制台嵌入样式，检查模式防止两套前端悄悄分叉。 */
const source = ["tokens.css", "console.css", "ui.css"]
  .map((name) => readFileSync(`src/web/ui/${name}`, "utf8"))
  .join("\n");
const output =
  "/** 自动生成：修改 src/web/ui 中的样式后执行 npm run sync:ui；禁止手改。 */\nexport const consoleStyles = " +
  JSON.stringify(source) +
  ";\n";
const target = "src/shared/ui-styles.ts";
if (process.argv.includes("--check")) {
  if (readFileSync(target, "utf8") !== output)
    throw Error("Console UI styles are stale; run npm run sync:ui");
} else writeFileSync(target, output);
