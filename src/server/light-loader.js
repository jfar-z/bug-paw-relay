// 此脚本由独立托管服务内联到沙箱文档，先完成资源授权，再解析发布者的页面。
(async () => {
  const { base, entry, prefix, ticket, html, channelId, mainOrigin } = JSON.parse(
    document.getElementById("light-input").textContent,
  );
  const postToHost = parent.postMessage.bind(parent);
  const notify = (type, ports = []) =>
    postToHost({ type, channelId }, mainOrigin, ports);
  try {
    const session = await fetch(prefix + "_session", {
      method: "POST",
      body: new URLSearchParams({ ticket }),
      credentials: "include",
      redirect: "error",
    });
    if (!session.ok) throw new Error(String(session.status));
    const ready = await fetch(prefix + "_ready", {
      credentials: "include",
      redirect: "error",
    });
    if (!ready.ok) throw new Error(String(ready.status));
  } catch {
    notify("relay.light.error");
    return;
  }
  const source = new TextDecoder().decode(
    Uint8Array.from(atob(html), (c) => c.charCodeAt(0)),
  );
  const parsed = new DOMParser().parseFromString(source, "text/html");
  const resourceBase = parsed.createElement("base");
  const authorBase = parsed.querySelector("base[href]")?.getAttribute("href");
  const resolveAsset = (raw, relativeTo) =>
    new URL(
      raw.startsWith("/") && !raw.startsWith("//") ? "." + raw : raw,
      raw.startsWith("/") ? prefix : relativeTo,
    ).href;
  resourceBase.href = authorBase ? resolveAsset(authorBase, base) : base;
  for (const el of parsed.querySelectorAll("[src], [href], [poster]")) {
    for (const attr of ["src", "href", "poster"]) {
      const raw = el.getAttribute(attr);
      if (raw?.startsWith("/") && !raw.startsWith("//"))
        el.setAttribute(attr, resolveAsset(raw, base));
    }
  }
  parsed.head.prepend(resourceBase);
  for (const element of Array.from(
    parsed.querySelectorAll(
      "script[src], script[type=module], link[rel=modulepreload], [crossorigin]",
    ),
  ))
    element.setAttribute("crossorigin", "use-credentials");
  // 沙箱内相对请求属于跨源请求，仅给本版资源补齐凭据。
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (
      typeof input === "string" &&
      input.startsWith("/") &&
      !input.startsWith("//")
    )
      input = resolveAsset(input, base);
    const url =
      input instanceof Request
        ? input.url
        : new URL(input, document.baseURI).href;
    return url.startsWith(prefix)
      ? nativeFetch(input, { credentials: "include", ...init })
      : nativeFetch(input, init);
  };
  document.open();
  // 在发布脚本运行前绑定文档端口，导航时关闭旧文档的端口。
  const channel = new MessageChannel();
  const port = channel.port1;
  let flush;
  const snapshot = await new Promise(resolve => {
    let initialized = false;
    port.onmessage = ({ data }) => {
      if (typeof data === "string") port.postMessage(data);
      else if (data?.type === "relay.light.flush" && flush) {
        flush();
        port.postMessage(data.challenge);
      }
      else if (!initialized && data?.type === "relay.light.init") {
        initialized = true;
        resolve(data);
      }
    };
    notify("relay.light.ready", [channel.port2]);
  });
  flush = installLightStorage(snapshot, message => port.postMessage(message), prefix, entry);
  window.addEventListener("pagehide", () => port.close(), { once: true });
  document.write("<!doctype html>" + parsed.documentElement.outerHTML);
  document.close();
})();
