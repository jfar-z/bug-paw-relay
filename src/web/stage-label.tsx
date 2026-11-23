import { NoWrap } from "./ui/index.js";
import { stageName } from "../shared/board-stages.js";
import { t, useLocale, currentLocale } from "./locale.js";
const stageMessageKeys = {
  draft: "web.numberAssignedAfterSaving",
  invalid: "web.invalidStageNumberReloadIfThisPersistsContactYour",
  deleted: "web.originalStageDeleted",
  upgrade: "web.waitingForConnectorUpgradeDispatchResumesAutomaticallyAfterUpgrade",
  instructions: "web.newExecutionHandoffToolsUseStageShortNumbersUuids",
} as const;

/** 阶段展示统一按应用当前语言解析，不按位置补造历史编号。 */
export function stageText(key: keyof typeof stageMessageKeys): string {
  return t(stageMessageKeys[key]);
}
export function stageLabel(stage: any, draft = false): string {
  if (!stage || stage.type === "deleted") return stageText("deleted");
  const prefix = /^S[1-9]\d*$/.test(stage.shortId || "")
    ? stage.shortId
    : stageText(draft ? "draft" : "invalid");
  return `${prefix} · ${stageName(stage, currentLocale())}`;
}
export function StageLabel({
  stage,
  draft = false,
}: {
  stage: any;
  draft?: boolean;
}) {
  useLocale();
  if (!stage || !/^S[1-9]\d*$/.test(stage.shortId || ""))
    return <span className="stage-label">{stageLabel(stage, draft)}</span>;
  return (
    <span className="stage-label" title={stageLabel(stage, draft)}>
      <NoWrap>{stage.shortId} · </NoWrap>
      {stageName(stage, currentLocale())}
    </span>
  );
}
