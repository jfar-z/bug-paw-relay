import { z } from "zod";

const dimensions = {
  cols: z.int().min(20).max(400),
  rows: z.int().min(5).max(150),
};
/** 光标按 UTF-16 偏移计数，轮询可重复，输入收到不确定回执时不能自动重放。 */
export const terminalAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), ...dimensions }).strict(),
  z
    .object({ action: z.literal("read"), cursor: z.int().nonnegative() })
    .strict(),
  z
    .object({ action: z.literal("write"), data: z.string().min(1).max(8192) })
    .strict(),
  z.object({ action: z.literal("resize"), ...dimensions }).strict(),
  z.object({ action: z.literal("close") }).strict(),
]);
