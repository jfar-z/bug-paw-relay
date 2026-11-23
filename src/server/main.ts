import { resolve } from "node:path";
import { createApp } from "./app.js";
/** 服务端入口；生产入口地址用于同源校验与安装接入指引。 */
const { app } = await createApp({
  dataDir: resolve(process.env.RELAY_DATA_DIR || "data"),
  publicUrl: process.env.RELAY_PUBLIC_URL || "http://localhost:3180",
  webDir: resolve("dist/web"),
  secureCookie: process.env.RELAY_INSECURE_COOKIE !== "true",
});
await app.listen({
  host: process.env.RELAY_HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3180),
});
console.log(
  "BugPaw Relay 服务已启动。初始化令牌位于数据目录 setup-token 文件。",
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void app.close().then(() => process.exit(0)));
