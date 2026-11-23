import React from "react";
import { Languages } from "lucide-react";
import { Select } from "./ui/index.js";
import {
  displayError,
  localeState,
  t,
  useLocale,
  type UiFeedback,
} from "./locale.js";
import type { LocalePreference } from "../shared/i18n.js";

/** 沿用统一 Select 的定位、键盘与焦点规则；入口在未认证页面同样可用。 */
export function LanguageMenu({
  onChange,
  saving,
  error,
}: {
  onChange?: (value: LocalePreference) => void;
  saving?: boolean;
  error?: UiFeedback;
}) {
  useLocale();
  const options = [
    {
      value: "auto",
      label: t("language.server", {
        language:
          localeState?.serverLocale === "zh-CN" ? "简体中文" : "English",
      }),
    },
    { value: "zh-CN", label: "简体中文" },
    { value: "en", label: "English" },
  ];
  const label = options.find(
    (option) => option.value === localeState?.preference,
  )!.label;
  return (
    <div className="language-control" aria-busy={saving}>
      <Select
        variant="ghost"
        value={localeState?.preference || "auto"}
        label={t("language.current", { language: label })}
        options={options}
        trigger={
          <>
            <Languages aria-hidden="true" />
            <span className="language-label">{label}</span>
          </>
        }
        onChange={(value) =>
          (onChange || localeState?.preview)?.(value as LocalePreference)
        }
      />
      {error && (
        <small role="alert" className="language-warning">
          {displayError(error)}
        </small>
      )}
    </div>
  );
}
