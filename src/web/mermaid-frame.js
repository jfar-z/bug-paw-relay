/** 只在无同源权限的沙箱中运行，正文通过消息端口传入，不拼接进 HTML。 */
mermaid.initialize({
  startOnLoad: false,
  securityLevel: "strict",
  theme: "neutral",
  htmlLabels: false,
  suppressErrorRendering: true,
  flowchart: { htmlLabels: false, useMaxWidth: false },
  sequence: { useMaxWidth: false },
});

addEventListener("message", async (event) => {
  const port = event.ports[0];
  if (event.source !== parent || !port) return;
  const { source, id } = event.data;
  try {
    const { diagramType } = await mermaid.parse(source);
    if (!["flowchart", "flowchart-v2", "sequence"].includes(diagramType))
      throw new Error();
    const { svg } = await mermaid.render(id, source);
    // 模板中的 SVG 保持惰性，序列化时补全命名空间，并去除图中链接。
    const template = document.createElement("template");
    template.innerHTML = svg;
    const root = template.content.querySelector("svg");
    for (const link of root.querySelectorAll("a")) {
      link.removeAttribute("href");
      link.removeAttributeNS("http://www.w3.org/1999/xlink", "href");
      link.removeAttribute("target");
    }
    const [, , width, height] = root
      .getAttribute("viewBox")
      .split(/\s+/)
      .map(Number);
    if (!(width > 0 && height > 0)) throw new Error();
    port.postMessage({
      svg: new XMLSerializer().serializeToString(root),
      width,
      height,
    });
  } catch {
    port.postMessage(null);
  } finally {
    port.close();
  }
});
