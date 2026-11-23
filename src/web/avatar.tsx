import { InputLabel } from "./ui/index.js";
import { FileInput, Range } from "./ui/index.js";
import {
  FeedbackError,
  feedback,
  caughtFeedback,
  type UiFeedback,
} from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import { createContext, useContext, useEffect, useRef, useState } from "react";
import Cropper, { type Area } from "react-easy-crop";
import { Button, ErrorBox, Modal } from "./ui/index.js";

/** 登录身份由应用壳提供，头像保存后两类消息即时同步。 */
export const IdentityContext = createContext({
  get username() {
    return tr("web.you");
  },
  avatar: "",
});

/** 图片失败时回退简称，不展示损坏图片。 */
export function Avatar({
  name,
  source = "",
  small = false,
  card = false,
}: {
  name: string;
  source?: string;
  small?: boolean;
  card?: boolean;
}) {
  useLocale();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [source]);
  const image =
    source.startsWith("data:image/") || source.startsWith("/assets/");
  return (
    <span
      className={
        card
          ? "agent-avatar"
          : `identity-avatar${small ? " small-avatar" : ""}${source === "/assets/bugpaw-avatar.png" ? " mascot-avatar" : ""}`
      }
    >
      {image && !failed ? (
        <img src={source} alt="" onError={() => setFailed(true)} />
      ) : image ? (
        name.slice(0, 1)
      ) : (
        source || name.slice(0, 1)
      )}
    </span>
  );
}

/** 保存稳定资源路径，清单顺序只影响面板展示。 */
const presetIds = [
  "bug",
  "deepseek-chibi-bowl",
  "deepseek",
  "gpt",
  "claude",
  "gemini",
  "qwen",
  "grok",
  "glm",
  "kimi",
  "minimax",
  "doubao",
  "hunyuan",
  "mimo",
  "product-manager",
  "frontend",
  "backend",
  "ui-designer",
  "qa",
  "devops",
  "tech-lead",
] as const;

function presetSource(id: (typeof presetIds)[number]) {
  return id === "bug"
    ? "/assets/icon-192.png"
    : `/assets/agent-avatars/${id}.png`;
}

/** 单项加载状态随面板重开而重置，失败时仍保留名称和位置。 */
function PresetOption({
  id,
  value,
  onChoose,
}: {
  id: (typeof presetIds)[number];
  value: string;
  onChoose: (source: string) => void;
}) {
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">(
    "loading",
  );
  const source = presetSource(id);
  const selected = value === source;
  return (
    <Button
      variant={selected ? "primary" : "secondary"}
      aria-pressed={selected}
      disabled={status !== "ready"}
      onClick={() => onChoose(source)}
    >
      <span className="avatar-preset-option">
        {status !== "unavailable" && (
          <img
            src={source}
            alt=""
            onLoad={() => setStatus("ready")}
            onError={() => setStatus("unavailable")}
          />
        )}
        <span>
          {selected && <span aria-hidden="true">✓ </span>}
          {tr(`web.avatarPreset.${id}`)}
        </span>
        {status !== "ready" && (
          <small>{tr(`web.avatarPreset.${status}`)}</small>
        )}
      </span>
    </Button>
  );
}

export function PresetPicker({
  value,
  onChoose,
}: {
  value: string;
  onChoose: (source: string) => void;
}) {
  useLocale();
  const [open, setOpen] = useState(false);
  const title = tr("web.avatarPreset.choose");
  return (
    <>
      <Button
        aria-haspopup="dialog"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        {title}
      </Button>
      {open && (
        <Modal title={title} onClose={() => setOpen(false)}>
          <div className="avatar-preset-grid">
            {presetIds.map((id) => (
              <PresetOption
                key={id}
                id={id}
                value={value}
                onChoose={(source) => {
                  onChoose(source);
                  setOpen(false);
                }}
              />
            ))}
          </div>
        </Modal>
      )}
    </>
  );
}

/** 同名配置附实际标识，避免相同头像与名称混淆。 */
export function agentOption(
  agent: { id: string; name: string; avatar?: string },
  peers: { name: string }[],
) {
  return {
    value: agent.id,
    label:
      peers.filter((peer) => peer.name === agent.name).length > 1
        ? agent.name + " · " + agent.id
        : agent.name,
    icon: (
      <span aria-hidden="true">
        <Avatar name={agent.name} source={agent.avatar} />
      </span>
    ),
  };
}

/** 用户靠右、智能体靠左的身份行独立于正文气泡。 */
export function MessageIdentity({
  user = false,
  agent,
  status,
}: {
  user?: boolean;
  agent?: { name: string; avatar?: string };
  status?: string;
}) {
  useLocale();
  const identity = useContext(IdentityContext);
  const name = user ? identity.username : agent?.name || "BugPaw Relay";
  const source = user
    ? identity.avatar
    : agent
      ? agent.avatar || ""
      : "/assets/bugpaw-avatar.png";
  return (
    <div className={`message-identity${user ? " is-user" : ""}`}>
      <Avatar name={name} source={source} />
      <span>
        {name}
        {status && <small> · {status}</small>}
      </span>
    </div>
  );
}

/** 选原图不设体积门槛，原图仅留在浏览器，确认裁切后才提交。 */
export function AvatarUpload({
  onSave,
  label = tr("web.uploadAvatarPngJpegWebp"),
}: {
  onSave: (avatar: string) => void | Promise<void>;
  label?: string;
}) {
  useLocale();
  const [file, setFile] = useState<File>();
  const [error, setError] = useState<UiFeedback>("");
  return (
    <div className="avatar-upload">
      <InputLabel>
        <span>{label}</span>
        <FileInput
          accept="image/png,image/jpeg,image/webp"
          onChange={(event) => {
            const selected = event.target.files?.[0];
            event.target.value = "";
            if (!selected) return;
            if (!/^image\/(png|jpeg|webp)$/.test(selected.type)) {
              setError(feedback("web.chooseAPngJpegOrWebpImage"));
              return;
            }
            setError("");
            setFile(selected);
          }}
        />
      </InputLabel>
      <ErrorBox error={error} />
      {file && (
        <AvatarCrop
          key={file.name + file.lastModified}
          file={file}
          onClose={() => setFile(undefined)}
          onSave={onSave}
        />
      )}
    </div>
  );
}

/** 固定正方形裁切，支持拖动、触控缩放与键盘调整，失败时保留选区。 */
function AvatarCrop({
  file,
  onClose,
  onSave,
}: {
  file: File;
  onClose: () => void;
  onSave: (avatar: string) => void | Promise<void>;
}) {
  useLocale();
  const [url, setUrl] = useState("");
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [area, setArea] = useState<Area>();
  const [error, setError] = useState<UiFeedback>("");
  const [busy, setBusy] = useState(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const source = URL.createObjectURL(file);
    setUrl(source);
    return () => {
      active.current = false;
      URL.revokeObjectURL(source);
    };
  }, [file]);
  async function save() {
    if (!area || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await compressAvatar(url, area);
      if (!active.current) return;
      await onSave(result);
      if (active.current) onClose();
    } catch (e) {
      if (active.current) setError(caughtFeedback(e as Error));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  return (
    <Modal title={tr("web.adjustAvatar")} onClose={onClose}>
      <p className="sub">{tr("web.dragToCropUseTheSliderOrPinchTo")}</p>
      <div
        className="avatar-crop-stage"
        aria-label={tr("web.avatarCropCanvas")}
        aria-busy={busy}
      >
        {url && (
          <Cropper
            image={url}
            crop={crop}
            zoom={zoom}
            aspect={1}
            maxZoom={4}
            onCropChange={setCrop}
            onZoomChange={setZoom}
            onCropComplete={(_, pixels) => setArea(pixels)}
            onMediaLoaded={() => setError("")}
            mediaProps={{
              onError: () => {
                setArea(undefined);
                setError(feedback("web.cannotReadThisImageChooseAValidImage"));
              },
            }}
          />
        )}
      </div>
      <InputLabel>
        <span>{tr("web.avatarZoom")}</span>
        <Range
          aria-label={tr("web.avatarZoom")}

          min="1"
          max="4"
          step="0.01"
          value={zoom}
          disabled={busy}
          onChange={(e) => setZoom(Number(e.target.value))}
        />
      </InputLabel>
      <ErrorBox error={error} />
      <footer>
        <Button disabled={busy} onClick={onClose}>
          {tr("web.cancel")}
        </Button>
        <Button
          variant="primary"
          disabled={!area || busy}
          onClick={() => void save()}
        >
          {busy ? tr("web.saving") : tr("web.cropAndSave")}
        </Button>
      </footer>
    </Modal>
  );
}

/** 优先保留清晰度；降低有限档质量后继续缩小尺寸，自动达到百 KB 目标。 */
async function compressAvatar(url: string, area: Area): Promise<string> {
  const image = new Image();
  image.src = url;
  await image.decode();
  const targetBytes = 100 * 1024;
  let size = Math.max(1, Math.floor(Math.min(512, area.width, area.height)));
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx)
    throw new FeedbackError(feedback("web.thisBrowserCannotProcessImages"));
  for (;;) {
    canvas.width = canvas.height = size;
    ctx.drawImage(
      image,
      area.x,
      area.y,
      area.width,
      area.height,
      0,
      0,
      size,
      size,
    );
    for (const quality of [0.82, 0.72, 0.62]) {
      const data = canvas.toDataURL("image/webp", quality);
      if (!data.startsWith("data:image/"))
        throw new FeedbackError(feedback("web.thisBrowserCannotEncodeImages"));
      // 按真实二进制体积判断，避免把 Base64 的额外开销算作头像文件大小。
      const encoded = data.slice(data.indexOf(",") + 1);
      const bytes =
        (encoded.length * 3) / 4 -
        (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
      if (bytes <= targetBytes) return data;
      // 极小尺寸的标准栅格编码必然低于目标，保留终止边界避免异常浏览器死循环。
      if (size === 1) return data;
    }
    // 不再要求用户重选范围；保留相同选区，通过缩小分辨率继续降低体积。
    size = Math.max(1, Math.floor(size * 0.75));
  }
}
