import { expect, type Locator } from "@playwright/test";

/** 三个真实文件入口使用相同的绘图、代码、表格与只读链接样本。 */
const fence = (name: string, body: string) =>
  ["```" + name, body, "```"].join("\n");
export const flow =
  'flowchart LR\n  A[Start] --> B[Review] --> C[Approve] --> D[Finish]\n\n  click B "https://example.invalid/jump"';
export const invalid = "flowchart LR\n  A[";
export const attachmentExamples = [
  fence("ascii", "  +--+\n  |  |\n  +--+\n\n  ┌" + "─".repeat(140) + "┐"),
  fence("mermaid", flow),
  fence(
    "mermaid",
    "sequenceDiagram\n  Client->>Server: Request\n  Server-->>Client: Response",
  ),
  fence("mermaid", invalid),
  fence("mermaid", 'pie\n  "A": 1'),
  fence("ts", "const n: number = 42"),
  fence("py", '# note\nprint("text")'),
  fence("sh", '# note\necho "text"'),
  fence("js", 'const n = "text"'),
  fence("json", '{"n": 42}'),
  fence("unknown", "  " + "plain".repeat(120)),
  fence("", "  plain text"),
  "| Left | Right | Detail | Value | Result |\n| :--- | ---: | --- | --- | --- |\n| A | B | C | D | E |",
].join("\n\n");

export async function checkAttachmentExamples(preview: Locator) {
  const images = preview.locator(".attachment-diagram img");
  await expect(images).toHaveCount(2, { timeout: 35000 });
  for (const image of await images.all())
    await expect
      .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
  await expect(
    preview.locator(".markdown-code-block .file-warning"),
  ).toHaveCount(2);
  // 点击指令可携带节点坐标；去掉导航时仍需保留原位。
  const graph = await images.first().evaluate((el) => {
    const svg = new DOMParser().parseFromString(
      decodeURIComponent(
        (el as HTMLImageElement).src.split(",").slice(1).join(","),
      ),
      "image/svg+xml",
    );
    const link = svg.querySelector("a");
    return {
      positioned: !!link?.getAttribute("transform"),
      target: link?.getAttributeNS("http://www.w3.org/1999/xlink", "href"),
    };
  });
  expect(graph).toEqual({ positioned: true, target: null });
  const table = preview.getByRole("table").last();
  await expect(table.getByRole("columnheader").nth(1)).toHaveCSS(
    "text-align",
    "right",
  );
  await expect(table.getByRole("cell").first()).toHaveCSS(
    "border-left-style",
    "solid",
  );
  for (const name of ["js", "ts", "py", "sh", "json"]) {
    const block = preview
      .locator(".markdown-code-block")
      .filter({ has: preview.page().getByText(name, { exact: true }) })
      .last();
    await expect(block.locator('code [class^="hljs-"]').first()).toBeAttached();
  }
  const plain = preview.locator("code.language-unknown");
  await expect(plain.locator("span")).toHaveCount(0);
  await expect(preview.locator(".attachment-ascii")).toHaveCSS(
    "white-space",
    "pre",
  );
  if (preview.page().viewportSize()?.width === 320) {
    for (const wide of [
      table.locator(".."),
      preview.locator(".attachment-ascii"),
      images.first().locator(".."),
    ]) {
      await wide.scrollIntoViewIfNeeded();
      await wide.focus();
      await expect(wide).toBeFocused();
      expect(await wide.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeGreaterThan(0);
      await preview.page().keyboard.press("ArrowRight");
      await expect
        .poll(() => wide.evaluate((el) => el.scrollLeft))
        .toBeGreaterThan(0);
      expect(
        await wide.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
          return Math.abs(el.scrollWidth - el.scrollLeft - el.clientWidth) <= 1;
        }),
      ).toBe(true);
    }
  }
  expect(await preview.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
}
