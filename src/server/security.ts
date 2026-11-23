import { message as i18nMessage } from "../shared/i18n.js";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import * as OTPAuth from "otpauth";
import { ensure } from "../shared/contracts.js";
export const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
/** 密码使用随机盐派生；仅保存派生结果，验证采用恒定时间比较。 */
export function passwordHash(password: string) {
  ensure(
    password.length >= 12,
    "WEAK_PASSWORD",
    i18nMessage("errors.WEAK_PASSWORD.the.password.must.contain.at.least"),
  );
  const salt = token();
  return salt + ":" + scryptSync(password, salt, 64).toString("hex");
}
export function passwordMatches(password: string, hash: string) {
  const [salt, value] = hash.split(":");
  const expected = Buffer.from(value, "hex");
  return timingSafeEqual(expected, scryptSync(password, salt, 64));
}
/** 凭据主密钥仅存在数据卷，不写入源码、响应或日志；恢复时须与数据库一同备份。 */
export class Vault {
  private key: Buffer;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const path = join(dir, "master.key");
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32), { mode: 0o600, flag: "wx" });
    this.key = readFileSync(path);
    ensure(
      this.key.length === 32,
      "KEY_INVALID",
      i18nMessage("errors.KEY_INVALID.invalid.master.key.length"),
    );
  }
  seal(value: string) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64");
  }
  open(value: string) {
    const data = Buffer.from(value, "base64");
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12),
    );
    decipher.setAuthTag(data.subarray(12, 28));
    return Buffer.concat([
      decipher.update(data.subarray(28)),
      decipher.final(),
    ]).toString("utf8");
  }
}
export function totp(secret: string, label = "BugPaw Relay") {
  return new OTPAuth.TOTP({
    issuer: "BugPaw Relay",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: OTPAuth.Secret.fromBase32(secret),
  });
}
