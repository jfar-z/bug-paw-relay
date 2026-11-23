import { readFileSync } from "node:fs";
import { connectorVersionSchema } from "../shared/contracts.js";

/** 读取发行包内的构建版本；源码运行或旧包缺少元数据时如实报告未知。 */
export function readConnectorVersion(
  path: string | URL = new URL("./release.json", import.meta.url),
): string | null {
  try {
    const metadata = JSON.parse(readFileSync(path, "utf8"));
    return connectorVersionSchema.parse(metadata.version);
  } catch {
    // 不回退到通用 package.json 版本，避免不同提交的包被误判为同一版本。
    return null;
  }
}
