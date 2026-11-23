import { createHash, createPublicKey } from "node:crypto";
import { z } from "zod";

/** 节点身份协议独立于业务 RPC 版本，拒绝降级到无上下文签名。 */
export const nodeAuthVersion = 2;
export const registrationSchema = z
  .object({
    code: z.string().min(1).max(256),
    name: z.string().min(1).max(100),
    publicKey: z.string().max(1000),
  })
  .strict();
export const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

/** 使用规范化公钥指纹，避免 PEM 换行差异改变身份。 */
export function nodeKeyFingerprint(publicKey: string): string {
  const key = createPublicKey(publicKey);
  if (key.asymmetricKeyType !== "ed25519")
    throw new Error("必须使用 Ed25519 身份");
  return createHash("sha256")
    .update(key.export({ type: "spki", format: "der" }))
    .digest("hex");
}

/** 固定字段顺序覆盖接入码、名称和公钥，注册证明不能移用于其他申请。 */
export function registrationDigest(
  input: z.infer<typeof registrationSchema>,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.code,
        input.name,
        nodeKeyFingerprint(input.publicKey),
      ]),
    )
    .digest("hex");
}

/** 结构化签名绑定协议、服务端、用途、身份与载荷，避免跨用途重放。 */
export function nodeProofText(
  origin: string,
  purpose: "register" | "connect",
  identity: string,
  publicKey: string,
  digest: string,
  nonce: string,
): string {
  return JSON.stringify([
    "bugpaw-relay-node",
    nodeAuthVersion,
    new URL(origin).origin,
    purpose,
    identity,
    nodeKeyFingerprint(publicKey),
    digest,
    nonceSchema.parse(nonce),
  ]);
}
