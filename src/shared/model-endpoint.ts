/** 仅用于轻提示：HTTP 回环端点保留本机模型的无提示体验。 */
export function insecureModelEndpoint(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      url.protocol === "http:" &&
      host !== "localhost" &&
      host !== "[::1]" &&
      !/^127\.\d+\.\d+\.\d+$/.test(host)
    );
  } catch {
    return false;
  }
}
