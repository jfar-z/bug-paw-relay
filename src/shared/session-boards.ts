import { z } from "zod";
import { directorySchema } from "./contracts.js";

export const boardCapability = "session-board-v1";
export const boardInstruction =
  "In BugPaw Relay, users can @mention a board to look up, create, archive, or share work items as clickable cards; consult the board docs tool if needed.";
const board = z.object({ boardId: z.uuid() }).strict();
const item = board.extend({ itemId: z.uuid() });
const file = z
  .string()
  .min(1)
  .max(4096)
  .refine(
    (path) =>
      !/[\\:\x00-\x1f]/.test(path) &&
      path.split("/").every((p) => p && p !== "." && p !== ".."),
  );

/** 两个原生运行时与服务端共享参数定义，调用身份由传输层单独提供。 */
export const boardTools = {
  docs: {
    description:
      "Read board scope, directory matching, approvals and PRD delivery guidance.",
    schema: z.object({}).strict(),
  },
  references: {
    description:
      "List accessible boards already mentioned in this conversation.",
    schema: z.object({}).strict(),
  },
  definition: {
    description: "Read board stages, valid starts and their directory match.",
    schema: board,
  },
  list: {
    description: "Find work items in a mentioned board.",
    schema: board.extend({
      keyword: z.string().max(200).optional(),
      stageId: z.uuid().optional(),
      archived: z.boolean().default(false),
      offset: z.number().int().nonnegative().default(0),
      limit: z.number().int().min(1).max(100).default(20),
    }),
  },
  detail: {
    description: "Read one work item by board and item ID.",
    schema: item,
  },
  share: {
    description: "Send a clickable work item card to this conversation.",
    schema: item,
  },
  archive: {
    description:
      "Archive one explicitly selected work item. Clarify ambiguous targets first.",
    schema: item,
  },
  create: {
    description:
      "Create one work item. Supply agreed requirements, acceptance criteria and required PRD files relative to this conversation directory. Creation sends a card automatically. For a non-agent start with multiple directories, select the intended materialDirectory.",
    schema: board.extend({
      title: z.string().trim().min(1).max(200),
      summary: z.string().trim().min(1).max(60000),
      acceptance: z.string().max(30000),
      files: z.array(file).max(16).default([]),
      startStageId: z.uuid().optional(),
      materialDirectory: directorySchema.optional(),
    }),
  },
};
export type BoardTool = keyof typeof boardTools;
export function boardTool(name: string): BoardTool | undefined {
  const key = name.replace(/^relay_board_/, "");
  if (name.startsWith("relay_board_") && Object.hasOwn(boardTools, key))
    return key as BoardTool;
}
