import { useEffect, useState } from "react";
import type { commandEntry, CommandScope } from "../shared/slash-commands.js";
import {
  api,
  Button,
  Check,
  Select,
  Modal,
  Panel,
  ErrorBox,
  Badge,
} from "./ui/index.js";
import { t, caughtFeedback, type UiFeedback } from "./locale.js";

type Entry = typeof commandEntry._output;
export type Catalog = { fixed: string[]; items: Entry[] };
type Directory = Pick<
  CommandScope,
  "environmentId" | "rootId" | "relativePath"
>;
export type CommandProject = {
  id: string;
  name: string;
  directories: Directory[];
};

/** 固定项说明使用产品语言，原生项保留 CLI 返回的参数和描述。 */
export function commandRows(catalog: Catalog, runtime: string) {
  return [
    ...catalog.fixed.map((name) => ({
      name,
      description: t("web.commands." + name),
      label: "Relay",
      hint: ["rename", "resume"].includes(name)
        ? t("web.commands." + name + "Hint")
        : "",
    })),
    ...catalog.items.map((item) => ({
      name: item.name,
      description: item.description,
      hint: item.argumentHint,
      label: runtime === "codex" ? "Codex" : "Claude Code",
    })),
  ];
}

/** 切换目录时卸载旧清单，迟到的发现或保存结果无法进入新的作用域。 */
export function CommandsDialog({
  environmentId,
  environmentName,
  runtime,
  projects,
  onClose,
}: {
  environmentId: string;
  environmentName: string;
  runtime: string;
  projects: CommandProject[];
  onClose: () => void;
}) {
  const options = projects.flatMap((project) =>
    project.directories
      .filter((d) => d.environmentId === environmentId)
      .map((d) => ({
        value: JSON.stringify([project.id, d.rootId, d.relativePath]),
        label: project.name + " · " + d.rootId + " / " + d.relativePath,
        scope: {
          projectId: project.id,
          rootId: d.rootId,
          relativePath: d.relativePath,
        },
      })),
  );
  const [key, setKey] = useState(options[0]?.value || "");
  const selected = options.find((o) => o.value === key);
  return (
    <Modal title={t("web.commands.title")} onClose={onClose}>
      <p>
        {environmentName} · {runtime === "codex" ? "Codex" : "Claude Code"}
      </p>
      {options.length > 0 && (
        <Select
          label={t("web.project")}
          value={key}
          options={options}
          onChange={setKey}
        />
      )}
      {!selected && <p>{t("web.commands.noProject")}</p>}
      <CommandSettings
        key={selected?.value || ""}
        path={"/environments/" + environmentId + "/commands"}
        runtime={runtime}
        scope={selected?.scope}
      />
    </Modal>
  );
}

function CommandSettings({
  path,
  runtime,
  scope,
}: {
  path: string;
  runtime: string;
  scope?: Omit<CommandScope, "environmentId" | "runtime">;
}) {
  const [catalog, setCatalog] = useState<Catalog>();
  const [error, setError] = useState<UiFeedback>("");
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    const request = { runtime, ...scope };
    async function load() {
      setBusy(true);
      setError("");
      try {
        const fresh = await api(path, request);
        if (current) setCatalog(fresh);
      } catch (failure) {
        if (!current) return;
        setError(caughtFeedback(failure));
        if (!catalog && scope) {
          // 缓存可能尚未建立，仍展示固定项并保留本次发现失败的原因。
          const cached = await api(path, { ...request, cached: true })
            .catch(() => api(path, { runtime }))
            .catch(() => undefined);
          if (current && cached) setCatalog(cached);
        }
      } finally {
        if (current) setBusy(false);
      }
    }
    void load();
    return () => {
      current = false;
    };
  }, [attempt, path, runtime]);
  async function save(item: Entry, enabled: boolean) {
    setBusy(true);
    setError("");
    try {
      const result = await api(path, {
        runtime,
        ...scope,
        change: { name: item.name, identity: item.identity, enabled },
      });
      setCatalog(
        (old) =>
          old && {
            ...old,
            items: old.items.map((i) =>
              i.identity === item.identity && i.name === item.name
                ? result.item
                : i,
            ),
          },
      );
    } catch (failure) {
      setError(caughtFeedback(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button disabled={busy} onClick={() => setAttempt((v) => v + 1)}>
        {t("web.commands.refresh")}
      </Button>
      {busy && <p role="status">{t("web.loading")}</p>}
      <ErrorBox error={error} />
      {catalog &&
        commandRows(catalog, runtime).map((row, index) => {
          const item = catalog.items[index - catalog.fixed.length];
          return (
            <Panel
              key={row.name}
              title={"/" + row.name + (row.hint ? " " + row.hint : "")}
            >
              <Badge>
                {item
                  ? t("web.commands." + item.source)
                  : t("web.commands.managed")}
              </Badge>
              <p>{row.description}</p>
              {item &&
                (item.execution ? (
                  <Check
                    checked={item.enabled}
                    disabled={busy}
                    onChange={(v) => void save(item, v)}
                  >
                    {t("web.commands.allow", { name: row.name })}
                  </Check>
                ) : (
                  <p>{t("web.commands.unavailable")}</p>
                ))}
            </Panel>
          );
        })}
    </>
  );
}
