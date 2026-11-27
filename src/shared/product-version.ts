import { createRequire } from "node:module";

/** 源码和发行包均从项目清单读取对外报告的产品版本。 */
export const productVersion: string = createRequire(import.meta.url)("../../package.json").version;
