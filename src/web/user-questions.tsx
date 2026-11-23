import { pollVisible } from "./api.js";
import { Badge } from "./ui/index.js";
import { InputLabel } from "./ui/index.js";
import { Textarea } from "./ui/index.js";
import { useEffect, useId, useRef, useState } from "react";
import {
  QuestionRecord,
  QuestionAnswer,
  validateQuestionAnswer,
} from "../shared/user-questions.js";
import { api, Button, Check, Input, ErrorBox } from "./ui/index.js";
import { t, useLocale } from "./locale.js";

/** 快照按执行与交互合并；历史读取不得抹除其他执行或倒退已确认的答案。 */
export function mergeQuestions(
  previous: QuestionRecord[] = [],
  incoming: QuestionRecord[] = [],
) {
  const records = new Map(previous.map((r) => [r.executionId + ":" + r.id, r]));
  for (const r of incoming) {
    const key = r.executionId + ":" + r.id;
    const old = records.get(key);
    records.set(key, old?.status === "answered" ? old : r);
  }
  return [...records.values()];
}

/** 每张卡独立核对原请求，不持久化草稿，也不在恢复连接后重放 POST。 */
export function QuestionCard({
  record: snapshot,
  connected,
  capable,
}: {
  record: QuestionRecord;
  connected: boolean;
  capable: boolean;
}) {
  useLocale();
  const id = useId();
  const [record, setRecord] = useState(snapshot);
  const [draft, setDraft] = useState<QuestionAnswer>({
    answers: snapshot.form.questions.map((q) => ({
      questionId: q.id,
      optionIds: [],
    })),
  });
  const [custom, setCustom] = useState<string[]>([]);
  const [verified, setVerified] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [invalid, setInvalid] = useState<number>();
  const [online, setOnline] = useState(navigator.onLine);
  const locked = useRef(false);
  const generation = useRef(0);
  const root = useRef<HTMLElement>(null);
  const query = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener("online", update);
    addEventListener("offline", update);
    return () => {
      removeEventListener("online", update);
      removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    let cancelled = false;
    let reading = false;
    setVerified(false);
    setRecord((old) => (old.status === "answered" ? old : snapshot));
    const read = async () => {
      if (
        cancelled ||
        reading ||
        locked.current ||
        !connected ||
        !online ||
        !capable
      )
        return;
      reading = true;
      const started = generation.current;
      try {
        const result = await api(
          `/executions/${snapshot.executionId}/interactions/${snapshot.id}`,
          undefined,
          undefined,
          15000,
        );
        if (!cancelled && started === generation.current) {
          setRecord(result.record);
          if (["answered", "invalidated"].includes(result.record.status))
            setError(undefined);
          setVerified(true);
        }
      } catch (e) {
        if (!cancelled) {
          setVerified(false);
          setError(e);
        }
      } finally {
        reading = false;
      }
    };
    query.current = read;
    const stop = pollVisible(read, 5000);
    return () => {
      cancelled = true;
      stop();
    };
    // 同状态历史快照不重新锁定控件，避免周期对账打断正在输入的焦点。
  }, [
    snapshot.id,
    snapshot.executionId,
    snapshot.status,
    connected,
    online,
    capable,
  ]);
  const editable =
    connected &&
    online &&
    capable &&
    verified &&
    record.status === "waiting" &&
    !busy;
  const change = (index: number, optionIds: string[], text?: string) => {
    setDraft((old) => ({
      answers: old.answers.map((a, i) =>
        i === index
          ? {
              questionId: a.questionId,
              optionIds,
              ...(text !== undefined ? { text } : {}),
            }
          : a,
      ),
    }));
    setInvalid(undefined);
    setError(undefined);
  };
  const submit = async () => {
    if (!editable || locked.current) return;
    let answer: QuestionAnswer;
    try {
      answer = validateQuestionAnswer(record.form, draft);
    } catch (e: any) {
      setError(e);
      setInvalid(e.messageParams?.question);
      const index = Number(e.messageParams?.question) - 1;
      root.current
        ?.querySelectorAll("fieldset")
        [index]?.querySelector<HTMLElement>("input,textarea,button")
        ?.focus();
      return;
    }
    locked.current = true;
    generation.current++;
    setBusy(true);
    setVerified(false);
    setError(undefined);
    try {
      const result = await api(
        `/executions/${record.executionId}/answer`,
        { interactionId: record.id, answer },
        undefined,
        20000,
      );
      setRecord(result.record);
    } catch (e) {
      setError(e);
    } finally {
      locked.current = false;
      setBusy(false);
      await query.current();
    }
  };
  const status = busy ? "submitting" : record.status;
  return (
    <section
      ref={root}
      className="question-card"
      aria-labelledby={id}
      aria-busy={busy}
    >
      <header>
        <h3 id={id}>{t("questions.title")}</h3>
        <Badge>
          {record.form.provider === "codex" ? "Codex" : "Claude Code"}
        </Badge>
      </header>
      <p role="status" className="note">
        {t("questions." + status)}
      </p>
      {!capable && <p className="error-box">{t("questions.upgrade")}</p>}
      {(!connected || !online || !verified) &&
        status === "waiting" &&
        capable && (
          <p role="status" className="note">
            {t("questions.reconciling")}
          </p>
        )}
      {!record.form.supported ? (
        <p className="error-box">{t("questions.unsupported")}</p>
      ) : (
        record.form.questions.map((q, index) => {
          const a = draft.answers[index];
          const actual = record.answer?.answers.find(
            (a) => a.questionId === q.id,
          );
          const textMode = !q.options.length || custom.includes(q.id);
          const readonly = record.status !== "waiting";
          return (
            <fieldset
              key={q.id}
              disabled={!editable}
              aria-invalid={invalid === index + 1}
              aria-describedby={
                invalid === index + 1 ? id + "-error" : undefined
              }
            >
              <legend>
                <span className="note">
                  {index + 1}. {q.header} ·{" "}
                  {t(
                    q.multiSelect ? "questions.multiple" : "questions.required",
                  )}
                </span>
                <span className="question-text">{q.question}</span>
              </legend>
              {readonly ? (
                <div className="question-answer">
                  {actual
                    ? q.secret
                      ? t("questions.hidden")
                      : [
                          ...q.options
                            .filter((o) => actual.optionIds.includes(o.id))
                            .map((o) => o.label),
                          ...(actual.text !== undefined ? [actual.text] : []),
                        ].join("\n")
                    : t("questions.noAnswer")}
                </div>
              ) : (
                <>
                  {q.options.map((o) => (
                    <Check
                      key={o.id}
                      checked={a.optionIds.includes(o.id)}
                      onChange={(checked) => {
                        if (!q.multiSelect)
                          setCustom((old) => old.filter((v) => v !== q.id));
                        change(
                          index,
                          q.multiSelect
                            ? checked
                              ? [...a.optionIds, o.id]
                              : a.optionIds.filter((v) => v !== o.id)
                            : checked
                              ? [o.id]
                              : [],
                          q.multiSelect ? a.text : undefined,
                        );
                      }}
                    >
                      <span>
                        <strong>{o.label}</strong>
                        <span className="question-description">
                          {o.description}
                        </span>
                      </span>
                    </Check>
                  ))}
                  {q.allowText && !!q.options.length && (
                    <Check
                      checked={textMode}
                      onChange={(checked) => {
                        setCustom((old) =>
                          checked
                            ? [...old, q.id]
                            : old.filter((v) => v !== q.id),
                        );
                        change(
                          index,
                          q.multiSelect ? a.optionIds : [],
                          checked ? "" : undefined,
                        );
                      }}
                    >
                      {t("questions.custom")}
                    </Check>
                  )}
                  {q.allowText && textMode && (
                    <InputLabel>
                      <span>{t("questions.text")}</span>
                      {q.secret ? (
                        <Input
                          type="password"
                          autoComplete="off"
                          value={a.text || ""}
                          onChange={(e) =>
                            change(index, a.optionIds, e.target.value)
                          }
                        />
                      ) : (
                        <Textarea
                          rows={3}
                          value={a.text || ""}
                          onChange={(e) =>
                            change(index, a.optionIds, e.target.value)
                          }
                        />
                      )}
                    </InputLabel>
                  )}
                </>
              )}
            </fieldset>
          );
        })
      )}
      <div id={id + "-error"}>
        <ErrorBox error={error} />
      </div>
      {record.form.supported && status === "waiting" && (
        <Button
          variant="primary"
          disabled={!editable}
          onClick={() => void submit()}
        >
          {t("questions.submit")}
        </Button>
      )}
      {(status === "unknown" || status === "submitting" || !verified) &&
        capable && (
          <Button
            disabled={!connected || !online || busy}
            onClick={() => void query.current()}
          >
            {t("questions.check")}
          </Button>
        )}
      <details className="note">
        <summary>{t("questions.reference")}</summary>
        <span>
          {record.executionId} / {record.id}
        </span>
      </details>
    </section>
  );
}
