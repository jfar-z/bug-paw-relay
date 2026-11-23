import { resolve } from "node:path";
import { createLightHost } from "./light-host.js";
// 复用产品镜像，通过独立进程、卷及域名部署。
const { app, internal } = await createLightHost({
  database: resolve(process.env.RELAY_DATA_DIR || "data", "light-apps.db"),
  domain: process.env.RELAY_LIGHT_DOMAIN || "",
  mainOrigin: process.env.RELAY_PUBLIC_URL || "",
  mainUrl: process.env.RELAY_INTERNAL_URL || "",
  key: process.env.RELAY_LIGHT_KEY || "",
});
await internal.listen({
  host: process.env.RELAY_HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3180),
});
// 代理仅转发公开端口，管理路由只注册在内网监听器。
await app.listen({
  host: process.env.RELAY_HOST || "127.0.0.1",
  port: Number(process.env.RELAY_LIGHT_PUBLIC_PORT || 3181),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void Promise.all([app.close(), internal.close()]));
