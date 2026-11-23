import { normalizeLocale, type Locale } from "./i18n.js";

/** 显式 POSIX locale 优先；Windows 无环境变量时使用 ICU 的操作系统 locale。 */
export function systemLocale(
  env: NodeJS.ProcessEnv = process.env,
  runtimeLocale = Intl.DateTimeFormat().resolvedOptions().locale,
): Locale {
  const candidate = [env.LC_ALL, env.LC_MESSAGES, env.LANG].find((v) =>
    v?.trim(),
  );
  return normalizeLocale(candidate || runtimeLocale) || "en";
}
