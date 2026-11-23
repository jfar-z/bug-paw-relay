import { handoffError, shortIdSchema } from "../shared/stage-handoff.js";

/** 高水位不随删除下降；此函数只在配置写入事务内使用。 */
export function numberStages(data: any, old?: any) {
  let high = old?.stageShortIdHighWater ?? 0;
  if (!Number.isSafeInteger(high) || high < 0)
    handoffError("STAGE_SHORT_ID_INVALID", "stageShortIdHighWater");
  for (const stage of old?.stages ?? []) {
    if (!shortIdSchema.safeParse(stage.shortId).success)
      handoffError("STAGE_SHORT_ID_INVALID", "stages");
    high = Math.max(high, Number(stage.shortId.slice(1)));
  }
  for (const [index, stage] of data.stages.entries()) {
    const previous = old?.stages.find((s: any) => s.id === stage.id);
    if (stage.shortId !== undefined && stage.shortId !== previous?.shortId)
      handoffError("STAGE_SHORT_ID_INVALID", `stages.${index}.shortId`);
    if (previous) stage.shortId = previous.shortId;
    else {
      if (high === Number.MAX_SAFE_INTEGER)
        handoffError("STAGE_SHORT_ID_EXHAUSTED");
      stage.shortId = `S${++high}`;
    }
  }
  data.stageShortIdHighWater = high;
}
