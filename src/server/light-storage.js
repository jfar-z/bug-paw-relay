// 同一实现也由调试工具提供，调用方在运行应用前传入本版本的快照。
export function installLightStorage({ entries, quota, hasBackend }, send, assetPrefix, entryFile = "") {
  const values = new Map(entries);
  let size = 0;
  for (const [key, value] of values) size += key.length + value.length;
  const changes = new Map();
  let timer;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (changes.size) send({ type: "relay.light.storage", changes: [...changes] });
    changes.clear();
  }
  function change(key, value) {
    changes.set(key, value);
    timer ??= setTimeout(flush, 80);
  }
  function report(kind, message, source = "", line = 0, column = 0) {
    // 仅保留本版相对资源名，不带资源授权路径或查询参数。
    source = typeof source === "string" ? source : "";
    let file = source === location.href ? entryFile : "";
    if (source.startsWith(assetPrefix)) file = source.slice(assetPrefix.length).split(/[?#]/)[0];
    // 业务异常可能直接包含响应正文，带后端版本只上报类型及行列。
    if (hasBackend && kind !== "storage") {
      message = { script: "Script error", resource: "Resource load failed", promise: "Unhandled rejection" }[kind];
      file = "";
    }
    send({ type: "relay.light.diagnostic", error: {
      kind, message: String(message).replace(/https?:\/\/\S+/g, "[URL]").slice(0, 512),
      file: file.slice(0, 512), line, column,
    } });
  }
  window.addEventListener("error", event => {
    if (event instanceof ErrorEvent)
      report("script", event.message, event.filename || "", event.lineno, event.colno);
    else if (event.target instanceof Element)
      report("resource", "Resource load failed", event.target.src || event.target.href || "");
  }, true);
  window.addEventListener("unhandledrejection", event => {
    const reason = event.reason;
    report("promise", typeof reason === "string" ? reason : reason?.message || "Unhandled rejection");
  });
  Object.defineProperty(window, "localStorage", { value: {
    get length() { return values.size; },
    key(index) { return [...values.keys()][Number(index) >>> 0] ?? null; },
    getItem(key) { return values.get(String(key)) ?? null; },
    setItem(key, value) {
      key = String(key);
      value = String(value);
      const previous = values.get(key);
      const previousSize = previous === undefined ? 0 : key.length + previous.length;
      const next = size - previousSize + key.length + value.length;
      if (next > quota) {
        report("storage", "QuotaExceededError");
        throw new DOMException("QuotaExceededError", "QuotaExceededError");
      }
      size = next;
      values.set(key, value);
      change(key, value);
    },
    removeItem(key) {
      key = String(key);
      const previous = values.get(key);
      if (previous === undefined) return;
      size -= key.length + previous.length;
      values.delete(key);
      change(key, null);
    },
    clear() {
      for (const key of values.keys()) change(key, null);
      values.clear();
      size = 0;
    },
  } });
  window.addEventListener("pagehide", flush, { once: true });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  return flush;
}
