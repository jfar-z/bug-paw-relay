import { z } from "zod";
import { ensure } from "./contracts.js";
import { message } from "./i18n.js";

export const userQuestionsCapability = "user-questions-v1";
/** 空题组是普通异步通知，保留其聊天正文。 */
export function isCodexAsyncQuestion(item: any): boolean {
  return (
    item?.type === "agentMessage" &&
    item.delivery === "async" &&
    typeof item.id === "string" &&
    Array.isArray(item.questions) &&
    item.questions.length > 0
  );
}
/** 选项使用组内稳定编号，避免同名选项或文本答案被错误地解释为选择。 */
export interface UserQuestion {
  id: string;
  header: string;
  question: string;
  options: { id: string; label: string; description: string }[];
  multiSelect: boolean;
  allowText: boolean;
  secret: boolean;
}
export interface QuestionForm {
  version: 1;
  provider: "codex" | "claude";
  supported: boolean;
  questions: UserQuestion[];
  reason?: "questions.unsupported";
}
export const questionAnswerSchema = z
  .object({
    answers: z.array(
      z
        .object({
          questionId: z.string(),
          optionIds: z.array(z.string()),
          text: z.string().optional(),
        })
        .strict(),
    ),
  })
  .strict();
export type QuestionAnswer = z.infer<typeof questionAnswerSchema>;
export interface QuestionRecord {
  id: string;
  executionId: string;
  sessionId: string;
  nativeId: string;
  /** 请求发生前已写入的最后一个环境事件序号，限定在本次执行内。 */
  afterSequence?: number;
  /** 原生提问消息或工具调用的标识，可跨历史与实时流定位。 */
  questionItemId?: string;
  /** Codex 接收异步答案的原生回合，配合完整回传内容识别用户消息。 */
  answerTurnId?: string;
  form: QuestionForm;
  status: "waiting" | "submitting" | "answered" | "unknown" | "invalidated";
  answer?: QuestionAnswer;
  reason?: string;
}
const nonempty = (v: unknown): v is string =>
  typeof v === "string" && !!v.trim();
/** 仅识别明确的原生提问，畸形请求显式降为不可答。 */
export function questionForm(
  method: string,
  params: any,
): QuestionForm | undefined {
  const asyncQuestion = method === "request_user_input_async";
  if (
    !asyncQuestion &&
    method !== "item/tool/requestUserInput" &&
    method !== "AskUserQuestion"
  )
    return;
  const provider = method === "AskUserQuestion" ? "claude" : "codex";
  const unsupported: QuestionForm = {
    version: 1,
    provider,
    supported: false,
    questions: [],
    reason: "questions.unsupported",
  };
  const raw =
    provider === "claude" ? params?.input?.questions : params?.questions;
  if (!Array.isArray(raw) || !raw.length || raw.length > 100)
    return unsupported;
  const questions: UserQuestion[] = [];
  const ids = new Set<string>();
  for (const [index, item] of raw.entries()) {
    // 异步题目没有原生题号，按调用内顺序标识，允许任意题目使用自定义文本。
    if (asyncQuestion && item?.options != null && !Array.isArray(item.options))
      return unsupported;
    const q = asyncQuestion
      ? {
          id: String(index),
          question: item?.title,
          isOther: true,
          options: item?.options?.map((label: unknown) => ({
            label,
            description: "",
          })),
        }
      : item;
    if (
      !q ||
      !nonempty(q.question) ||
      (q.header !== undefined && typeof q.header !== "string")
    )
      return unsupported;
    // Claude 原生以题文作键，重复题文无法无损回传，必须拒绝整组。
    const nativeKey = provider === "codex" ? q.id : q.question;
    if (!nonempty(nativeKey) || ids.has(nativeKey)) return unsupported;
    ids.add(nativeKey);
    if (q.options != null && !Array.isArray(q.options)) return unsupported;
    const options = q.options || [];
    if (
      options.some(
        (o: any) =>
          !o || !nonempty(o.label) || typeof o.description !== "string",
      ) ||
      new Set(options.map((o: any) => o.label)).size !== options.length
    )
      return unsupported;
    if (
      provider === "codex" &&
      ((q.isOther !== undefined && typeof q.isOther !== "boolean") ||
        (q.isSecret !== undefined && typeof q.isSecret !== "boolean") ||
        q.multiSelect === true)
    )
      return unsupported;
    if (provider === "claude" && typeof q.multiSelect !== "boolean")
      return unsupported;
    questions.push({
      id: provider === "codex" ? q.id : String(index),
      header: q.header || "",
      question: q.question,
      options: options.map((o: any, i: number) => ({
        id: String(i),
        label: o.label,
        description: o.description,
      })),
      multiSelect: provider === "claude" && q.multiSelect,
      allowText: provider === "claude" || !options.length || q.isOther === true,
      secret: provider === "codex" && q.isSecret === true,
    });
  }
  return { version: 1, provider, supported: true, questions };
}
/** 前端可共用校验；环境端始终重新执行。返回题号而不把题目或答案放入错误日志。 */
export function validateQuestionAnswer(
  form: QuestionForm,
  value: unknown,
): QuestionAnswer {
  ensure(
    form.supported,
    "UNSUPPORTED_QUESTION",
    message("questions.unsupported"),
    409,
  );
  const parsed = questionAnswerSchema.safeParse(value);
  ensure(
    parsed.success,
    "INVALID_ANSWER",
    message("questions.invalid", { question: 0 }),
  );
  const answers = parsed.data!.answers;
  ensure(
    answers.length === form.questions.length &&
      new Set(answers.map((a) => a.questionId)).size === answers.length,
    "INVALID_ANSWER",
    message("questions.invalid", { question: 0 }),
  );
  const ordered = form.questions.map((q, index) => {
    const a = answers.find((a) => a.questionId === q.id);
    const text = a?.text;
    const hasText = text !== undefined;
    ensure(
      a &&
        new Set(a.optionIds).size === a.optionIds.length &&
        a.optionIds.every((id) => q.options.some((o) => o.id === id)) &&
        (!hasText || (q.allowText && nonempty(text))) &&
        a.optionIds.length + Number(hasText) > 0 &&
        (q.multiSelect || a.optionIds.length + Number(hasText) === 1),
      "INVALID_ANSWER",
      message("questions.invalid", { question: index + 1 }),
    );
    return {
      questionId: q.id,
      optionIds: q.options
        .filter((o) => a!.optionIds.includes(o.id))
        .map((o) => o.id),
      ...(hasText ? { text } : {}),
    };
  });
  return { answers: ordered };
}
/** Codex 使用题目 ID 数组；Claude 保留原输入，并按 SDK 约定用逗号分隔多选。 */
export function nativeQuestionAnswer(
  form: QuestionForm,
  params: any,
  answer: QuestionAnswer,
) {
  const entries = form.questions.map((q, i) => {
    const a = answer.answers[i];
    const values = [
      ...a.optionIds.map((id) => q.options.find((o) => o.id === id)!.label),
      ...(a.text !== undefined ? [a.text] : []),
    ];
    return [
      form.provider === "codex" ? q.id : q.question,
      form.provider === "codex" ? { answers: values } : values.join(", "),
    ];
  });
  const answers = Object.fromEntries(entries);
  return form.provider === "codex"
    ? { answers }
    : { approve: true, updatedInput: { ...params.input, answers } };
}
