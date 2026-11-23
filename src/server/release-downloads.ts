import { message as i18nMessage } from "../shared/i18n.js";
import { z } from "zod";
import { ensure } from "../shared/contracts.js";
import { Store } from "./store.js";
import { Vault } from "./security.js";

/** 安装包授权独立于登录 token；加密凭证绑定文件、登录会话及绝对失效时间。 */
export class ReleaseDownloads {
  constructor(
    private store: Store,
    private vault: Vault,
  ) {}

  /** 配置只影响新签发链接，既有凭证保持原到期时间。 */
  settings() {
    const saved = this.store
      .list("settings")
      .find((s) => s.id === "release-downloads");
    return {
      expiresMinutes: saved?.expiresMinutes ?? 10,
      version: saved?.version ?? 0,
    };
  }

  /** 分钟值限定为正整数，版本校验防止多窗口覆盖。 */
  configure(input: unknown) {
    const data = z
      .object({
        expiresMinutes: z.number().int().min(1).max(10080),
        version: z.number().int().min(0),
      })
      .strict()
      .parse(input);
    return this.store.transaction(() => {
      ensure(
        this.settings().version === data.version,
        "CONFLICT",
        i18nMessage(
          "errors.CONFLICT.download.configuration.has.changed.refresh.the",
        ),
        409,
      );
      this.store.put(
        "settings",
        { expiresMinutes: data.expiresMinutes },
        "release-downloads",
      );
      return this.settings();
    });
  }

  /** 每次签发和下载复核原登录会话，注销后即使链接未到期也不可再用。 */
  private login(owner: string) {
    ensure(
      this.store.db
        .prepare("SELECT hash FROM auth_sessions WHERE hash=? AND expires>?")
        .get(owner, Date.now()),
      "UNAUTHENTICATED",
      i18nMessage("errors.UNAUTHENTICATED.sign.in.or.obtain.a.new"),
      401,
    );
  }

  issue(owner: string, file: string) {
    this.login(owner);
    const expiresAt = Date.now() + this.settings().expiresMinutes * 60000;
    const grant = Buffer.from(
      this.vault.seal(
        JSON.stringify({ purpose: "release-download", owner, file, expiresAt }),
      ),
      "base64",
    ).toString("base64url");
    return {
      url: `/downloads/${encodeURIComponent(file)}?grant=${grant}`,
      grant,
      expiresAt,
    };
  }

  verify(grant: unknown, file: string) {
    let data: any;
    try {
      const value = z.string().min(1).max(4096).parse(grant);
      data = JSON.parse(
        this.vault.open(Buffer.from(value, "base64url").toString("base64")),
      );
    } catch {
      ensure(
        false,
        "DOWNLOAD_UNAUTHORIZED",
        i18nMessage(
          "errors.DOWNLOAD_UNAUTHORIZED.sign.in.to.obtain.a.temporary",
        ),
        401,
      );
    }
    ensure(
      data.purpose === "release-download" &&
        typeof data.owner === "string" &&
        Number.isFinite(data.expiresAt) &&
        data.expiresAt > Date.now() &&
        (file === data.file || file === data.file + ".sha256"),
      "DOWNLOAD_EXPIRED",
      i18nMessage(
        "errors.DOWNLOAD_EXPIRED.download.authorization.expired.or.the.file",
      ),
      403,
    );
    this.login(data.owner);
  }
}
