import { useEffect, useEffectEvent, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import type { z } from "zod";
import type { terminalAction } from "../shared/claude-terminal.js";
import { caughtFeedback, feedback, t as tr, type UiFeedback } from "./locale.js";
import { api, Button, ErrorBox, Modal } from "./ui/index.js";
import "@xterm/xterm/css/xterm.css";
import "./ui/claude-terminal.css";

type TerminalAction = z.infer<typeof terminalAction>;
type TerminalRead = { data: string; cursor: number; gap: boolean; exited: boolean };
type Phase = "idle" | "opening" | "attached" | "detached" | "closing" | "closed";
type TerminalControls = { open: () => void; close: () => void; write: (text: string) => void; screenReader: (enabled: boolean) => void };

const statusLabels = {
  idle: "web.native.status.idle",
  opening: "web.native.status.opening",
  attached: "web.native.status.attached",
  detached: "web.native.status.detached",
  closing: "web.native.status.closing",
  closed: "web.native.status.closed",
  offline: "web.native.status.offline",
  disabled: "web.native.status.disabled",
};

const touchKeys = [
  ["web.native.up", "\x1b[A"],
  ["web.native.down", "\x1b[B"],
  ["web.native.tab", "\t"],
  ["web.native.enter", "\r"],
  ["web.native.escape", "\x1b"],
  ["web.native.interrupt", "\x03"],
] as const;

/** 原生终端正文仅存于当前仿真器。离开页面只结束轮询，显式结束才关闭客户端。 */
export default function ClaudeTerminal({
  sessionId,
  autoOpen,
  online,
  disabled,
  canClose,
  running,
  onChanged,
}: {
  sessionId: string;
  autoOpen: boolean;
  online: boolean;
  disabled: boolean;
  canClose: boolean;
  running: boolean;
  onChanged: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const exitFocus = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const controls = useRef<TerminalControls>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<UiFeedback>("");
  const [gap, setGap] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [screenReader, setScreenReader] = useState(false);
  const changed = useEffectEvent(onChanged);
  const initialOpen = useEffectEvent(() => autoOpen && online && !disabled);

  useEffect(() => {
    const element = host.current!;
    const terminal = new Terminal({
      cursorBlink: false,
      disableStdin: true,
      fontFamily: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
      fontSize: 13,
      scrollback: 1500,

    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(element);
    // OSC 52 可能请求读写剪贴板，OSC 8 可能诱导打开外部链接。
    terminal.parser.registerOscHandler(52, () => true);
    terminal.parser.registerOscHandler(8, () => true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type === "keydown" && event.key === "F6") {
        event.preventDefault();
        toolbar.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
        return false;
      }
      return true;
    });

    const theme = () => {
      const css = getComputedStyle(element);
      const color = (name: string) => css.getPropertyValue(name).trim();
      terminal.options.theme = {
        background: color("--surface"),
        foreground: color("--text"),
        cursor: color("--text"),
        selectionBackground: color("--border"),
      };
    };
    theme();
    const appearance = new MutationObserver(theme);
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });

    let disposed = false;
    let phase: Phase = "idle";
    let cursor = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = "";
    let writing = false;
    let resizing = false;
    let sizeSent = "";
    let generation = 0;
    const path = "/sessions/" + sessionId + "/terminal";
    const call = (input: TerminalAction) => api(path, input, "POST", 20_000);
    const current = (token: number) => !disposed && token === generation;
    const update = (next: Phase) => {
      phase = next;
      terminal.options.disableStdin = next !== "attached";
      setPhase(next);
    };
    const resetConnection = () => {
      clearTimeout(pollTimer);
      pending = "";
      return ++generation;
    };
    const disconnect = (token: number, failure: unknown, input = false) => {
      if (!current(token)) return;
      resetConnection();
      update("detached");
      setError(input ? feedback("web.native.inputUncertain") : caughtFeedback(failure));
      changed();
    };
    const dimensions = () => ({
      cols: Math.max(20, Math.min(400, terminal.cols)),
      rows: Math.max(5, Math.min(150, terminal.rows)),
    });
    const dimensionKey = ({ cols, rows }: ReturnType<typeof dimensions>) =>
      cols + "x" + rows;
    const resize = async () => {
      const size = dimensions();
      const key = dimensionKey(size);
      if (phase !== "attached" || resizing || key === sizeSent) return;
      const token = generation;
      resizing = true;
      try {
        await call({ action: "resize", ...size });
        if (current(token)) sizeSent = key;
      } catch (failure) {
        disconnect(token, failure);
      } finally {
        resizing = false;
        if (!disposed && dimensionKey(dimensions()) !== sizeSent) void resize();
      }
    };
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(element);
    const onResize = terminal.onResize(() => void resize());

    const read = async (token: number) => {
      try {
        const result: TerminalRead = await call({ action: "read", cursor });
        if (!current(token)) return;
        if (result.gap) {
          terminal.reset();
          setGap(true);
        }
        if (result.data) {
          await new Promise<void>((done) => terminal.write(result.data, done));
          if (!current(token)) return;
        }
        cursor = result.cursor;
        if (result.exited) {
          resetConnection();
          update("closed");
          changed();
        } else {
          pollTimer = setTimeout(() => void read(token), 300);
        }
      } catch (failure) {
        disconnect(token, failure);
      }
    };
    const flush = async () => {
      if (writing || phase !== "attached" || !pending) return;
      const token = generation;
      const data = pending;
      pending = "";
      writing = true;
      try {
        await call({ action: "write", data });
      } catch (failure) {
        disconnect(token, failure, true);
      } finally {
        writing = false;
        if (!disposed) void flush();
      }
    };
    const write = (data: string) => {
      if (phase !== "attached") return;
      // 请求失败后丢弃待发送内容，避免在重连后重复提交原生命令或批准。
      if (pending.length + data.length > 8192) {
        setError(feedback("web.native.inputTooLarge"));
        return;
      }
      pending += data;
      void flush();
    };
    const onData = terminal.onData(write);

    const open = async () => {
      if (phase === "opening" || phase === "closing" || phase === "attached") return;
      const token = resetConnection();
      update("opening");
      setError("");
      fit.fit();
      const size = dimensions();
      try {
        await call({ action: "open", ...size });
        if (!current(token)) return;
        sizeSent = dimensionKey(size);
        cursor = 0;
        setGap(false);
        terminal.reset();
        update("attached");
        changed();
        void resize();
        void read(token);
        if (!matchMedia("(pointer: coarse)").matches) terminal.focus();
      } catch (failure) {
        disconnect(token, failure);
      }
    };
    const close = async () => {
      if (phase === "opening" || phase === "closing") return;
      const token = resetConnection();
      update("closing");
      setError("");
      try {
        await call({ action: "close" });
        if (!current(token)) return;
        update("closed");
        changed();
        // 关闭按钮可能禁用，将焦点移回终端区的标题。
        exitFocus.current?.focus();
      } catch (failure) {
        disconnect(token, failure);
      }
    };
    controls.current = {
      open: () => void open(),
      close: () => void close(),
      write,
      screenReader: (enabled) => { terminal.options.screenReaderMode = enabled; },
    };
    const auto = initialOpen() ? setTimeout(() => void open(), 0) : undefined;
    return () => {
      disposed = true;
      resetConnection();
      clearTimeout(auto);
      controls.current = null;
      appearance.disconnect();
      observer.disconnect();
      onResize.dispose();
      onData.dispose();
      terminal.dispose();
    };
  }, [sessionId]);

  const waiting = phase === "opening" || phase === "closing";
  const status = !online ? "offline" : disabled ? "disabled" : phase;
  return (
    <section className="claude-terminal" aria-label={tr("web.native.title")}>
      <div className="claude-terminal-toolbar" ref={toolbar}>
        <div ref={exitFocus} tabIndex={-1}>
          <strong>{tr("web.native.title")}</strong>
          <p role="status">{tr(statusLabels[status])}</p>
        </div>
        <div className="claude-terminal-actions">
          <Button variant="ghost" aria-pressed={screenReader} onClick={() => {
            controls.current?.screenReader(!screenReader);
            setScreenReader(!screenReader);
          }}>
            {tr("web.native.screenReader")}
          </Button>
          {phase !== "attached" && (
            <Button variant="primary" disabled={!online || disabled || waiting} onClick={() => controls.current?.open()}>
              {tr(running || phase === "detached" ? "web.native.reconnect" : "web.native.open")}
            </Button>
          )}
          {(running || phase === "attached" || phase === "detached" || phase === "closing") && (
            <Button disabled={!online || !canClose || waiting} onClick={() => setConfirm(true)}>
              {tr("web.native.end")}
            </Button>
          )}
        </div>
      </div>
      <ErrorBox error={error} />
      {gap && <p className="claude-terminal-note" role="status">{tr("web.native.gap")}</p>}
      <div className="claude-terminal-screen" ref={host} />
      <div className="claude-terminal-keys" aria-label={tr("web.native.keys")} role="group">
        {touchKeys.map(([label, data]) => (
          <Button key={label} disabled={!online || disabled || phase !== "attached"} onClick={() => controls.current?.write(data)}>
            {tr(label)}
          </Button>
        ))}
      </div>
      <p className="claude-terminal-note">{tr("web.native.hint")}</p>
      {confirm && (
        <Modal title={tr("web.native.end")} onClose={() => setConfirm(false)}>
          <p>{tr("web.native.confirmEnd")}</p>
          <footer>
            <Button onClick={() => setConfirm(false)}>{tr("web.cancel")}</Button>
            <Button variant="danger" onClick={() => {
              setConfirm(false);
              controls.current?.close();
            }}>
              {tr("web.native.end")}
            </Button>
          </footer>
        </Modal>
      )}
    </section>
  );
}
