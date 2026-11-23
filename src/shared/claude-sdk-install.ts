import { z } from "zod";

/** 远程接口只传递安装意图和可展示的探测摘要。 */
export const claudeSdkCapability = "claude-sdk-install-v1";
export const claudeSdkStatus = z.object({
  mode: z.enum(["custom", "environment"]),
  version: z.string().max(80),
  state: z.enum(["installed", "missing", "unknown"]),
  installing: z.boolean(),
});
