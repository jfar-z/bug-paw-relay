import {
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AppError } from "../shared/contracts.js";
import { message, preference, type LocalePreference } from "../shared/i18n.js";

export { systemLocale } from "../shared/system-locale.js";
export function parseLanguageArgs(input: readonly string[]) {
  const args: string[] = [];
  let override: LocalePreference | undefined;
  for (let i = 0; i < input.length; i++) {
    if (input[i] !== "--lang") {
      args.push(input[i]);
      continue;
    }
    const value = input[++i];
    if (override !== undefined || !["auto", "zh-CN", "en"].includes(value))
      throw new AppError("INVALID_PARAMS", message("cli.language.invalid"));
    override = value as LocalePreference;
  }
  return { args, override };
}
export function readLocalePreference(dir: string) {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(dir, "preferences.json"), "utf8"),
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    const data = value as Record<string, unknown>;
    if (
      data.version !== 1 ||
      !["auto", "zh-CN", "en"].includes(String(data.localePreference))
    )
      throw new Error();
    return {
      preference: preference(data.localePreference),
      source: "file" as const,
      corrupt: false,
    };
  } catch (error) {
    return {
      preference: "auto" as LocalePreference,
      source: "system" as const,
      corrupt: (error as NodeJS.ErrnoException).code !== "ENOENT",
    };
  }
}
/** 同目录排他临时文件与原子替换；失败不覆盖原文件、不触碰配置和凭据。 */
export function saveLocalePreference(dir: string, value: LocalePreference) {
  const file = join(dir, "preferences.json");
  const temporary = join(dir, `.preferences-${randomUUID()}.tmp`);
  try {
    let previous: Record<string, unknown> = {};
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        previous = parsed;
    } catch {
      /* 显式设置允许修复损坏的偏好，不读取业务配置。 */
    }
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(
      temporary,
      JSON.stringify({ ...previous, version: 1, localePreference: value }) +
        "\n",
      { encoding: "utf8", mode: 0o600, flag: "wx" },
    );
    renameSync(temporary, file);
  } catch {
    throw new AppError(
      "PREFERENCE_WRITE_FAILED",
      message("cli.language.writeFailed"),
    );
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* 原子替换成功后临时文件已不存在。 */
    }
  }
}
