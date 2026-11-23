import { Row } from "./ui/index.js";
import { feedback, caughtFeedback, type UiFeedback } from "./locale.js";
import { t as tr, useLocale, currentLocale, displayError } from "./locale.js";
import React, { useRef, useState } from "react";
import { boardNameSchema } from "../shared/contracts.js";
import { api, Button, Field, Input, Modal } from "./ui/index.js";

type TitleBoard = { id: string; name: string; version: number };

/** 草稿使用打开时的版本；轮询不能悄悄更新提交基线。 */
export function BoardTitleEditor({
  board,
  onClose,
  onSaved,
}: {
  board: TitleBoard;
  onClose: () => void;
  onSaved: (board: TitleBoard) => void;
}) {
  useLocale();
  const [draft, setDraft] = useState(board.name);
  const [base, setBase] = useState(board);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<UiFeedback>("");
  const [blocked, setBlocked] = useState(false);
  const [needsRead, setNeedsRead] = useState(false);
  const [uncertain, setUncertain] = useState<string | null>(null);
  const [latest, setLatest] = useState<TitleBoard | null>(null);
  const parsed = boardNameSchema.safeParse(draft);
  const validation = parsed.success ? "" : tr("validation.invalid");
  const canSave =
    parsed.success &&
    parsed.data !== base.name &&
    !busy &&
    !blocked &&
    !needsRead;

  /** 明确鉴权或对象错误停止写入，不继续读取受限对象。 */
  function failure(e: any) {
    if ([401, 403, 404].includes(e.status)) {
      setBlocked(true);
      setError(
        e.status === 401
          ? feedback("web.yourLoginHasExpiredPleaseSignInAgain")
          : feedback("web.thisBoardNoLongerExistsOrIsInaccessible"),
      );
    } else {
      setError(
        e.code === "CONFLICT"
          ? feedback("web.theBoardHasChangedReviewTheLatestContentAnd")
          : feedback("web.saveFailedPleaseTryAgain"),
      );
    }
  }

  async function readLatest() {
    if (lock.current || blocked) return;
    lock.current = true;
    setBusy(true);
    try {
      const state = await api("/state", undefined, undefined, 15000);
      const current = state.boards.find(
        (entry: TitleBoard) => entry.id === board.id,
      );
      if (!current) {
        setBlocked(true);
        setError(feedback("web.thisBoardNoLongerExistsOrIsInaccessible"));
        return;
      }
      // 响应丢失只通过读取确认，不自动重发写入。
      if (uncertain !== null && current.name === uncertain) {
        onSaved(current);
        return;
      }
      setLatest(current);
      setBase(current);
      setNeedsRead(false);
      setUncertain(null);
      setError(
        feedback("web.latestTitleLoadedReviewItAlongsideYourDraftBefore"),
      );
    } catch (e: any) {
      if ([401, 403, 404].includes(e.status)) failure(e);
      else setError(feedback("web.couldNotLoadTheTitleYourDraftIsKept"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  async function save() {
    if (!canSave || !parsed.success || lock.current) return;
    if (!navigator.onLine) {
      setError(feedback("web.networkUnavailableReconnectAndTryAgain"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      const updated = await api(
        "/boards/" + board.id + "/title",
        { name: parsed.data, version: base.version },
        "PATCH",
        15000,
      );
      onSaved(updated);
    } catch (e: any) {
      if (e.code === "CONFLICT") {
        setNeedsRead(true);
        failure(e);
      } else if (!e.status || e.status >= 500) {
        setUncertain(parsed.data);
        setNeedsRead(true);
        setError(feedback("web.saveResultIsUnconfirmedLoadTheLatestTitleTo"));
      } else failure(e);
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }

  return (
    <Modal
      title={tr("web.editBoardTitle")}
      onClose={onClose}
      busy={busy}
      closeOnBackdrop={false}
      trapFocus
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
        aria-busy={busy}
      >
        <Field label={tr("web.boardTitle")}>
          <Input
            data-initial-focus
            value={draft}
            disabled={busy || blocked || uncertain !== null}
            aria-invalid={!!validation}
            aria-describedby="board-title-feedback"
            onFocus={(event) =>
              event.currentTarget.setSelectionRange(
                event.currentTarget.value.length,
                event.currentTarget.value.length,
              )
            }
            onChange={(event) => setDraft(event.target.value)}
            onPaste={(event) => {
              // 单行输入会吞掉换行；保留原始粘贴内容交给统一校验拒绝。
              const text = event.clipboardData.getData("text");
              if (/[\r\n]/u.test(text)) {
                event.preventDefault();
                setDraft(text);
              }
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing || event.keyCode === 229)
              )
                event.preventDefault();
            }}
          />
        </Field>
        <p id="board-title-feedback" role="status">
          {validation ||
            displayError(error) ||
            (busy
              ? tr("web.processingPleaseWait")
              : tr("web.upTo100LengthUnitsDuplicateNamesAreAllowed"))}
        </p>
        {latest && (
          <p className="note board-title-latest">
            {tr("web.latestTitle")}
            {latest.name}
          </p>
        )}
        <Row>
          {needsRead && !blocked && (
            <Button
              type="button"
              disabled={busy}
              onClick={() => void readLatest()}
            >
              {tr("web.loadLatestTitle")}
            </Button>
          )}
          <Button type="button" disabled={busy} onClick={onClose}>
            {tr("web.cancel")}
          </Button>
          <Button variant="primary" type="submit" disabled={!canSave}>
            {busy ? tr("web.processing") : tr("web.save")}
          </Button>
        </Row>
      </form>
    </Modal>
  );
}
