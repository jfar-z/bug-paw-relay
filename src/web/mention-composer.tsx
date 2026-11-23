import { commandRows, type Catalog } from "./slash-commands.js";
import { Textarea } from "./ui/index.js";
import { caughtFeedback, feedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, displayError } from "./locale.js";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { File, Folder, Sparkles, Columns3 } from "lucide-react";
import { api, composerKeyDown } from "./ui/index.js";
import {
  editMentions,
  mentionQuery,
  mentionText,
  type Mention,
  type MentionItem,
} from "../shared/mentions.js";
import "./ui/mention-composer.css";
/** 保留 textarea 原生编辑、输入法及辅助功能，镜像层仅显示已选择引用的高亮。 */
export function MentionComposer({
  value,
  mentions,
  onChange,
  onSend,
  runtime,
  sessionId,
  online,
  disabled,
}: {
  value: string;
  mentions: Mention[];
  onChange: (text: string, mentions: Mention[]) => void;
  onSend: () => void;
  runtime: string;
  sessionId: string;
  online: boolean;
  disabled: boolean;
}) {
  useLocale();
  const input = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [caret, setCaret] = useState(0);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [result, setResult] = useState<{
    key: string;
    items: MentionItem[];
    notes: UiFeedback[];
  }>({ key: "", items: [], notes: [] });
  const [index, setIndex] = useState(0);
  const id = useId();
  const query =
    !disabled && focused && !composing
      ? mentionQuery(value, caret, mentions)
      : null;
  const slash =
    !disabled && focused && !composing && /^\/[^\s/\\]*$/u.test(value);
  const slashKey = "slash:" + sessionId;
  const slashOpen = slash && dismissed !== slashKey;
  const [catalog, setCatalog] = useState<Catalog>();
  const [commandError, setCommandError] = useState<UiFeedback>("");
  useEffect(() => {
    if (!slashOpen) return;
    let current = true;
    setCatalog(undefined);
    setCommandError("");
    api("/sessions/" + sessionId + "/commands", {})
      .then((rows) => {
        if (current) setCatalog(rows);
      })
      .catch((error) => {
        if (current) setCommandError(caughtFeedback(error));
      });
    return () => {
      current = false;
    };
  }, [slashOpen, sessionId, online]);
  const commands =
    slashOpen && catalog
      ? commandRows(catalog, runtime).filter((row) =>
          row.name.startsWith(value.slice(1)),
        )
      : [];
  useEffect(() => {
    if (slash) setIndex(0);
  }, [value, slash]);
  function chooseCommand(name: string) {
    const text = "/" + name + " ";
    pendingCaret.current = text.length;
    setDismissed(slashKey);
    onChange(text, []);
  }
  const key = query
    ? JSON.stringify([sessionId, query.start, query.query])
    : "";
  const open = !!key && key !== dismissed;
  const items = online && result.key === key ? result.items : [];
  const loading = open && online && result.key !== key;
  const syncScroll = () => {
    if (input.current && mirror.current) {
      mirror.current.scrollTop = input.current.scrollTop;
      mirror.current.scrollLeft = input.current.scrollLeft;
    }
  };
  useLayoutEffect(() => {
    if (pendingCaret.current !== null) {
      input.current?.focus();
      input.current?.setSelectionRange(
        pendingCaret.current,
        pendingCaret.current,
      );
      setCaret(pendingCaret.current);
      pendingCaret.current = null;
    }
    syncScroll();
  }, [value]);
  useLayoutEffect(() => {
    const node = input.current;
    if (!node) return;
    const resize = new ResizeObserver(() => {
      if (mirror.current) {
        mirror.current.style.width = `${node.clientWidth}px`;
        mirror.current.style.height = `${node.clientHeight}px`;
      }
      syncScroll();
    });
    resize.observe(node);
    return () => resize.disconnect();
  }, []);
  useEffect(() => {
    if (!open || !online) return;
    let cancelled = false;
    setIndex(0);
    const timer = setTimeout(
      () => {
        void api("/sessions/" + sessionId + "/mentions", {
          query: query!.query,
        })
          .then((data) => {
            if (!cancelled)
              setResult({
                key,
                items: data.items,
                // Skill 与文件搜索独立返回提示，保留每一项的语言描述符。
                notes: data.warningMessages?.length
                  ? data.warningMessages
                  : data.warning ? [feedback("common.failure")] : [],
              });
          })
          .catch((e) => {
            if (!cancelled)
              setResult({ key, items: [], notes: [caughtFeedback(e)] });
          });
      },
      query!.query ? 150 : 0,
    );
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, open, online, sessionId]);
  useEffect(() => {
    const node = list.current?.children[index] as HTMLElement | undefined;
    const parent = list.current;
    if (!node || !parent) return;
    if (node.offsetTop < parent.scrollTop) parent.scrollTop = node.offsetTop;
    if (
      node.offsetTop + node.offsetHeight >
      parent.scrollTop + parent.clientHeight
    )
      parent.scrollTop =
        node.offsetTop + node.offsetHeight - parent.clientHeight;
  }, [index]);
  const change = (text: string) => {
    setDismissed("");
    onChange(text, editMentions(value, text, mentions));
  };
  const choose = (item: MentionItem) => {
    if (!query) return;
    const token = mentionText(item);
    const next =
      value.slice(0, query.start) + token + " " + value.slice(query.end);
    const selected: Mention = {
      ...item,
      start: query.start,
      end: query.start + token.length,
    };
    pendingCaret.current = selected.end + 1;
    setDismissed(key);
    onChange(
      next,
      [...editMentions(value, next, mentions), selected].sort(
        (a, b) => a.start - b.start,
      ),
    );
  };
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (const m of mentions) {
    parts.push(value.slice(from, m.start));
    parts.push(<mark key={m.start}>{value.slice(m.start, m.end)}</mark>);
    from = m.end;
  }
  parts.push(value.slice(from) + "\n");
  return (
    <div className="mention-composer">
      {slashOpen && (
        <div className="mention-popup">
          <div className="mention-heading">
            <span>{tr("web.commands.title")}</span>
            <small>{tr("web.commands.keys")}</small>
          </div>
          <div
            id={id}
            role="listbox"
            aria-label={tr("web.commands.title")}
            className="mention-options"
            ref={list}
          >
            {commands.map((row, i) => (
              <div
                role="option"
                id={id + "-" + i}
                key={row.name}
                aria-selected={i === index}
                className="mention-option command-option"
                data-managed={row.label === "Relay"}
                onMouseDown={(e) => e.preventDefault()}
                onMouseMove={() => setIndex(i)}
                onClick={() => chooseCommand(row.name)}
              >
                <span>
                  <strong>
                    /{row.name} {row.hint}
                  </strong>
                  <small>{row.description}</small>
                </span>
                <small className="mention-kind">{row.label}</small>
              </div>
            ))}
          </div>
          {!commands.length && (
            <div role="status" className="mention-note">
              {displayError(commandError) ||
                tr(catalog ? "web.commands.empty" : "web.loading")}
            </div>
          )}
        </div>
      )}
      {open && (
        <div className="mention-popup">
          <div className="mention-heading">
            <span>{tr("web.referenceEnvironmentContent")}</span>
            <small>{tr("web.toChooseTabEnterToInsert")}</small>
          </div>
          <div
            id={id}
            role="listbox"
            aria-label={tr("web.availableReferences")}
            className="mention-options"
            ref={list}
          >
            {items.map((item, i) => {
              const Icon =
                item.kind === "skill"
                  ? Sparkles
                  : item.kind === "folder"
                    ? Folder
                    : item.kind === "board" ? Columns3 : File;
              return (
                <div
                  role="option"
                  id={`${id}-${i}`}
                  key={item.kind + item.path}
                  aria-selected={i === index}
                  className="mention-option" data-kind={item.kind}
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseMove={() => setIndex(i)}
                  onClick={() => choose(item)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.description || item.path}</small>
                  </span>
                  <small className="mention-kind">
                    {item.kind === "skill"
                      ? "Skill"
                      : item.kind === "folder"
                        ? tr("web.folder")
                        : tr(item.kind === "board" ? "web.board" : "web.file")}
                  </small>
                </div>
              );
            })}
          </div>
          {(!online || loading || !items.length || result.notes.length > 0) && (
            <div className="mention-note" role="status">
              {!online
                ? tr("web.environmentOfflineReconnectToSearchReferences")
                : loading
                  ? tr("web.searchingEnvironmentContent")
                  : result.notes.length
                    ? result.notes.map((note, i) => <div key={i}>{displayError(note)}</div>)
                    : tr("web.noMatchesTryAFilenamePathOrSkillName")}
            </div>
          )}
        </div>
      )}
      <div className="mention-input">
        <div className="mention-highlight" ref={mirror} aria-hidden="true">
          {parts}
        </div>
        <Textarea
          variant="composer"
          ref={input}
          aria-label={tr("web.sendToEnvironmentAgent")}
          role="combobox"
          aria-multiline="true"
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={open || slashOpen}
          aria-controls={open || slashOpen ? id : undefined}
          aria-activedescendant={
            (open && items[index]) || (slashOpen && commands[index])
              ? `${id}-${index}`
              : undefined
          }
          disabled={disabled}
          value={value}
          placeholder={
            online
              ? tr("web.describeATaskOrContinueTheConversationTypeTo")
              : tr("web.environmentOfflineEditYourDraftAndSendItWhen")
          }
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onScroll={syncScroll}
          onSelect={(e) => {
            const n = e.currentTarget;
            setCaret(
              n.selectionStart === n.selectionEnd ? n.selectionStart : -1,
            );
          }}
          onChange={(e) => {
            setCaret(e.target.selectionStart);
            change(e.target.value);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(e) => {
            setComposing(false);
            setCaret(e.currentTarget.selectionStart);
          }}
          onKeyDown={(e) => {
            if (composing || e.nativeEvent.isComposing || e.keyCode === 229)
              return;
            if (
              slashOpen &&
              !e.shiftKey &&
              !e.ctrlKey &&
              !e.metaKey &&
              !e.altKey
            ) {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(slashKey);
                return;
              }
              if (
                commands.length &&
                ["ArrowDown", "ArrowUp", "Tab"].includes(e.key)
              ) {
                e.preventDefault();
                if (e.key === "Tab")
                  chooseCommand(commands[index]?.name || commands[0].name);
                else
                  setIndex(
                    (i) =>
                      (i + (e.key === "ArrowDown" ? 1 : -1) + commands.length) %
                      commands.length,
                  );
                return;
              }
            }
            if (open && !e.shiftKey && !e.ctrlKey && !e.metaKey && !e.altKey) {
              if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                if (items.length)
                  setIndex(
                    (v) =>
                      (v + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length,
                  );
                return;
              }
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setDismissed(key);
                return;
              }
              if (e.key === "Enter" || e.key === "Tab") {
                e.preventDefault();
                if (!e.repeat && items[index]) choose(items[index]);
                return;
              }
            }
            composerKeyDown(e, onSend, change, (p) => {
              pendingCaret.current = p;
            });
          }}
        />
      </div>
    </div>
  );
}
