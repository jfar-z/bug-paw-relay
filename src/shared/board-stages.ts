import { translate, type Locale } from "./i18n.js";

/** 默认名称按显式资源键显示，用户名称从不按字符串猜测或替换。 */
export function stageName(
  stage: { name: string; nameKey?: string },
  locale: Locale,
): string {
  return stage.nameKey ? translate(locale, stage.nameKey) : stage.name;
}

/** 新建空看板的两个固定节点；UUID 由调用端提供以保持草稿和重试稳定。 */
export function defaultBoardStages(startId: string, doneId: string) {
  return [
    {
      id: startId,
      fixedRole: "start" as const,
      type: "human" as const,
      name: "Not started",
      nameKey: "board.stage.notStarted" as const,
      targets: [doneId],
    },
    {
      id: doneId,
      type: "done" as const,
      name: "Done",
      nameKey: "board.stage.done" as const,
      targets: [],
    },
  ];
}
