import { parse } from "@babel/parser";
import { readFileSync, readdirSync } from "node:fs";
import { relative, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 所有业务页面接受组件复用检查；只有库内部可以定义原生控件。 */
export function inspectUi(source, file) {
  const tree = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx"],
  });
  const errors = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "JSXOpeningElement") {
      const tag = node.name?.name;
      if (["button", "input", "textarea", "select", "dialog"].includes(tag))
        errors.push(`${file}: use shared UI instead of <${tag}>`);
      for (const attr of node.attributes) {
        if (attr.type !== "JSXAttribute") continue;
        if (attr.name.name === "style")
          errors.push(`${file}: inline appearance is not allowed`);
        if (
          attr.name.name === "className" &&
          attr.value?.type === "StringLiteral" &&
          /(?:^|\s)(?:btn|primary|icon-button|select-trigger|field|ui-button|ui-input)(?:\s|$)/.test(
            attr.value.value,
          )
        )
          errors.push(
            `${file}:${node.loc.start.line}: legacy control class is not allowed`,
          );
      }
    }
    if (
      node.type === "ImportDeclaration" &&
      /(?:components|ui\/(?:primitives|controls|layouts))\.js$/.test(
        node.source.value,
      )
    )
      errors.push(`${file}: import the ui entry instead of legacy primitives`);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "comments", "tokens"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  };
  visit(tree);
  return errors;
}
export function checkUi(root = process.cwd()) {
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(join(root, "src/web"));
  const errors = [];
  for (const path of files) {
    const file = relative(root, path).replaceAll("\\", "/"),
      source = readFileSync(path, "utf8");
    if (
      file.endsWith(".tsx") &&
      (!file.startsWith("src/web/ui/") || file === "src/web/ui/showcase.tsx")
    )
      errors.push(...inspectUi(source, file));
    if (file.endsWith(".css") && !file.startsWith("src/web/ui/"))
      errors.push(`${file}: shared UI selectors belong to src/web/ui`);
    if (
      file.endsWith(".css") &&
      file !== "src/web/ui/tokens.css" &&
      /#[\da-f]{3,8}\b/i.test(source)
    )
      errors.push(`${file}: literal colors belong to tokens.css`);
  }
  return errors;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = checkUi();
  if (errors.length) {
    process.stderr.write(errors.join("\n") + "\n");
    process.exitCode = 1;
  } else
    console.log(
      "UI contracts passed (all pages checked; no legacy exemptions).",
    );
}
