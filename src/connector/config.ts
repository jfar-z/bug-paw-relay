import { translate, type Locale } from "../shared/i18n.js";
import { message as i18nMessage } from "../shared/i18n.js";
import { assertNotUpdating } from "./update-installation.js";
import {
  nodeAuthVersion,
  nodeProofText,
  registrationDigest,
  nonceSchema,
} from "../shared/node-identity.js";
import { homedir } from "node:os";
import { resolve, join, isAbsolute } from "node:path";
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  renameSync,
  realpathSync,
  statSync,
} from "node:fs";
import { generateKeyPairSync, sign } from "node:crypto";
import { z } from "zod";
import { Vault } from "../server/security.js";
import { ensure } from "../shared/contracts.js";
export const connectorSchema = z.object({
  serverUrl: z.url(),
  name: z.string().min(1),
  environmentId: z.string().optional(),
  privateKey: z.string().optional(),
  publicKey: z.string().optional(),
  roots: z
    .array(z.object({ id: z.string().min(1), path: z.string().min(1) }))
    .min(1),
  codex: z
    .object({
      command: z.string().default("codex"),
      baseUrl: z.string().default(""),
      model: z.string().default(""),
      apiKey: z.string().default(""),
    })
    .default({ command: "codex", baseUrl: "", model: "", apiKey: "" }),
  claude: z
    .object({
      mode: z.enum(["custom", "environment"]).default("custom"),
      command: z.string().default("claude"),
      baseUrl: z.string().default(""),
      model: z.string().default(""),
      apiKey: z.string().default(""),
      authType: z.enum(["key", "bearer"]).default("key"),
    })
    .default({
      mode: "custom",
      command: "claude",
      baseUrl: "",
      model: "",
      apiKey: "",
      authType: "key",
    }),
});
const localConnectorSchema = connectorSchema.extend({
  serverUrl: z.union([z.url(), z.literal("")]),
});

/** 用户数据独立于免安装包；升级只换应用文件，配置和密钥位置保持兼容。 */
export class ConnectorConfig {
  readonly dir: string;
  readonly file: string;
  readonly vault: Vault;
  constructor(
    dir = process.env.BUGPAW_HOME || join(homedir(), ".bugpaw-relay"),
  ) {
    this.dir = resolve(dir);
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.file = join(this.dir, "config.json");
    this.vault = new Vault(this.dir);
  }
  read(): any {
    return existsSync(this.file)
      ? localConnectorSchema.parse(JSON.parse(readFileSync(this.file, "utf8")))
      : {
          // 首次配置不预填私人部署；保存和注册仍要求有效的服务端地址。
          ...connectorSchema.omit({ serverUrl: true }).parse({
            name: translate("en", "connector.defaultName"),
            roots: [{ id: "workspace", path: process.cwd() }],
          }),
          serverUrl: process.env.BUGPAW_SERVER_URL || "",
        };
  }
  save(input: any) {
    return this.write(input, false);
  }
  /** 首次启动时允许先保存 Claude 模式，完整配置和注册仍要求服务端地址。 */
  saveClaudeMode(patch: { mode: "custom" | "environment"; command?: string }) {
    const config = this.read();
    return this.write({ ...config, claude: { ...config.claude, ...patch } }, !config.environmentId);
  }
  private write(input: unknown, allowEmptyServer: boolean) {
    assertNotUpdating();
    const data = (allowEmptyServer ? localConnectorSchema : connectorSchema).parse(input);
    if (data.serverUrl) validateServerUrl(data.serverUrl);
    ensure(
      new Set(data.roots.map((r) => r.id)).size === data.roots.length,
      "DUPLICATE_ROOT",
      i18nMessage("errors.DUPLICATE_ROOT.workspace.root.ids.must.be.unique"),
    );
    // 根目录必须独立于启动位置，保存前验证，避免错误配置在重连后才暴露。
    for (const root of data.roots) {
      ensure(
        isAbsolute(root.path),
        "ROOT_ABSOLUTE",
        i18nMessage("connector.roots.absoluteRequired"),
      );
      ensure(
        existsSync(root.path) && statSync(root.path).isDirectory(),
        "ROOT_INVALID",
        i18nMessage("connector.roots.invalid"),
      );
      root.path = realpathSync(root.path);
    }
    ensure(
      new Set(
        data.roots.map((r) =>
          process.platform === "win32" ? r.path.toLowerCase() : r.path,
        ),
      ).size === data.roots.length,
      "DUPLICATE_PATH",
      i18nMessage("errors.DUPLICATE_PATH.workspace.root.paths.must.be.unique"),
    );
    const temporary = this.file + ".tmp";
    writeFileSync(temporary, JSON.stringify(data, null, 2), { mode: 0o600 });
    renameSync(temporary, this.file);
    return data;
  }
  public() {
    const c = this.read();
    delete c.privateKey;
    delete c.publicKey;
    for (const k of ["codex", "claude"])
      c[k] = { ...c[k], apiKey: "", hasKey: !!c[k]?.apiKey };
    return c;
  }
  runtime() {
    const c = this.read();
    for (const k of ["codex", "claude"])
      if (c[k]?.apiKey) c[k].apiKey = this.vault.open(c[k].apiKey);
    return c;
  }
  update(input: any) {
    assertNotUpdating();
    const previous = this.read();
    const sameServer = input.serverUrl === previous.serverUrl;
    const data = {
      ...previous,
      ...input,
      environmentId: sameServer ? previous.environmentId : undefined,
      privateKey: sameServer ? previous.privateKey : undefined,
      publicKey: sameServer ? previous.publicKey : undefined,
    };
    for (const k of ["codex", "claude"])
      data[k] = {
        ...previous[k],
        ...input[k],
        apiKey: input[k]?.apiKey
          ? this.vault.seal(input[k].apiKey)
          : previous[k]?.apiKey || "",
      };
    return this.save(data);
  }
  async register(code: string, locale: Locale = "en") {
    assertNotUpdating();
    const config = this.read();
    validateServerUrl(config.serverUrl);
    const { publicKey, privateKey } = generateKeyPairSync("ed25519");
    const key = publicKey.export({ type: "spki", format: "pem" }).toString();
    const registration = { code, name: config.name, publicKey: key };
    const challengeResponse = await fetch(
      new URL("/api/node/challenge", config.serverUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": locale,
        },
        body: JSON.stringify(registration),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      },
    );
    const proof: any = await challengeResponse.json();
    ensure(
      challengeResponse.ok,
      "REGISTER_FAILED",
      i18nMessage("connector.registration.challengeFailed"),
    );
    ensure(
      proof.authVersion === nodeAuthVersion &&
        proof.audience === new URL(config.serverUrl).origin,
      "AUTH_PROTOCOL",
      i18nMessage(
        "errors.AUTH_PROTOCOL.identity.protocol.mismatch.upgrade.the.server",
      ),
    );
    const challenge = nonceSchema.parse(proof.challenge);
    const signature = sign(
      null,
      Buffer.from(
        nodeProofText(
          config.serverUrl,
          "register",
          "",
          key,
          registrationDigest(registration),
          challenge,
        ),
      ),
      privateKey,
    ).toString("base64");
    const response = await fetch(
      new URL("/api/node/register", config.serverUrl),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept-Language": locale,
        },
        body: JSON.stringify({
          ...registration,
          challenge,
          signature,
          authVersion: nodeAuthVersion,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      },
    );
    const data: any = await response.json();
    ensure(
      response.ok,
      "REGISTER_FAILED",
      i18nMessage("connector.registration.failed"),
    );
    this.save({
      ...config,
      environmentId: data.id,
      publicKey: key,
      privateKey: this.vault.seal(
        privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      ),
    });
  }
}
export function validateServerUrl(value: string) {
  const url = new URL(value);
  ensure(
    url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)),
    "HTTPS_REQUIRED",
    i18nMessage("errors.HTTPS_REQUIRED.remote.connections.require.https"),
  );
  return url;
}
