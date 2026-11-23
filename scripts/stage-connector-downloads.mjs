import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readConnectorRelease } from "../dist/server/connector-release.js";

// 构建目录可能保留旧版完整包，只将当前清单中的两个平台复制到最终镜像。
const source = process.argv[2];
const output = process.argv[3];
const release = readConnectorRelease(source);
if (!release || release.releases.length !== 2 || new Set(release.releases.map(item => item.platform)).size !== 2)
  throw Error("连接器发行清单缺少 Windows 或 Linux 包");
mkdirSync(output, { recursive: true });
for (const file of ["release.json", ...release.releases.flatMap(item => [item.file, item.file + ".sha256"])])
  copyFileSync(join(source, "downloads", file), join(output, file));
