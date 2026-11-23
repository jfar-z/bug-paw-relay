import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { connectorVersionSchema } from "../shared/contracts.js";

/** 只认可服务端实际提供下载的发行包，不能用应用版本替代连接器版本。 */
const releaseSchema = z.object({
  version: connectorVersionSchema,
  revision: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
  updateProtocol: z.unknown().optional(),
  dataFormat: z.unknown().optional(),
  rollbackCompatible: z.unknown().optional(),
  compatibility: z.unknown().optional(),
  claudeOnDemand: z.boolean().optional(),
  releases: z
    .array(
      z.object({
        platform: z.enum(["linux", "windows"]),
        arch: z.literal("x64"),
        size: z.number().int().positive().optional(),
        sha256: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        file: z
          .string()
          .regex(
            /^bugpaw-relay-[A-Za-z0-9.+-]+-(?:linux|windows)-x64\.(?:tar\.gz|zip)$/,
          ),
      }),
    )
    .min(1),
});
export type ConnectorRelease = z.infer<typeof releaseSchema>;

/** 缺失、损坏或不完整的清单返回不可比较，不误报某个版本为最新。 */
export function readConnectorRelease(webDir?: string): ConnectorRelease | null {
  if (!webDir) return null;
  try {
    const directory = join(webDir, "downloads");
    const release = releaseSchema.parse(
      JSON.parse(readFileSync(join(directory, "release.json"), "utf8")),
    );
    for (const item of release.releases) {
      const expected = `bugpaw-relay-${release.version}-${item.platform}-x64.${item.platform === "windows" ? "zip" : "tar.gz"}`;
      if (item.file !== expected || !existsSync(join(directory, item.file)))
        return null;
    }
    return release;
  } catch {
    // 开发环境可以没有发行包；此时不展示无法核实的升级提醒。
    return null;
  }
}

/** 以完整发行标识比较是否一致，提交后缀不能按字符串大小或服务端提交排序。 */
export function connectorUpdate(
  current: string | null | undefined,
  platform: string | undefined,
  release: ConnectorRelease | null,
) {
  const normalized = connectorVersionSchema.safeParse(current);
  const currentVersion = normalized.success ? normalized.data : null;
  const target =
    platform === "win32/x64"
      ? "windows"
      : platform === "linux/x64"
        ? "linux"
        : null;
  const download = release?.releases.find(
    (r) => r.platform === target && r.arch === "x64",
  );
  return {
    currentVersion,
    latestVersion: release?.version || null,
    status: !release
      ? "unavailable"
      : !currentVersion
        ? "unknown"
        : currentVersion === release.version
          ? "current"
          : "different",
    downloadUrl: download ? "/downloads/" + download.file : null,
    claudeOnDemand: !!download && release?.claudeOnDemand === true,
  };
}

/** 将部署地址与当前平台发行包写入脚本字面值，避免引用请求 Host 或源码默认域名。 */
export function renderInstaller(
  template: string,
  platform: "linux" | "windows",
  publicUrl: string,
  release: ConnectorRelease,
): string {
  const url = new URL(publicUrl);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("安装脚本需要不含凭据的 HTTP/HTTPS 部署地址");
  const item = release.releases.find((entry) => entry.platform === platform);
  if (!item) throw new Error("当前平台发行包不可用");
  // 两种 shell 都使用单引号字面值，按各自规则转义单引号。
  const quote = (value: string) =>
    value.replaceAll("'", platform === "linux" ? "'\"'\"'" : "''");
  return template
    .replaceAll("__BUGPAW_SERVER_URL__", () => quote(url.origin))
    .replaceAll("__BUGPAW_PACKAGE__", () => quote(item.file));
}
