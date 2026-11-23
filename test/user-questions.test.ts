import { errorBody } from "../src/shared/i18n-errors.js";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Engine } from "../src/connector/engine.js";
import { ConnectorStore } from "../src/connector/store.js";
import {
  questionForm,
  validateQuestionAnswer,
  nativeQuestionAnswer,
} from "../src/shared/user-questions.js";

const params = {
  questions: [
    {
      id: "a",
      header: "选择",
      question: "问题",
      isOther: true,
      options: [
        { label: "A", description: "甲" },
        { label: "B", description: "乙" },
      ],
    },
    { id: "b", header: "文本", question: "问题", options: null },
  ],
};
const form = questionForm("item/tool/requestUserInput", params)!;
const value = {
  answers: [
    { questionId: "a", optionIds: ["0"] },
    { questionId: "b", optionIds: [], text: " 中文\nEnglish " },
  ],
};

test("精确识别、重复键拒绝、逐题校验与原生编码", () => {
  assert.equal(questionForm("fake/requestUserInput", params), undefined);
  assert.equal(
    questionForm("item/tool/requestUserInput", {
      questions: [params.questions[0], params.questions[0]],
    })!.supported,
    false,
  );
  assert.equal(
    questionForm("AskUserQuestion", {
      input: {
        questions: [
          { question: "重复", multiSelect: true },
          { question: "重复", multiSelect: false },
        ],
      },
    })!.supported,
    false,
  );
  assert.equal(
    questionForm("item/tool/requestUserInput", { questions: [null] })!
      .supported,
    false,
  );
  const answer = validateQuestionAnswer(form, value);
  assert.deepEqual(nativeQuestionAnswer(form, params, answer), {
    answers: { a: { answers: ["A"] }, b: { answers: [" 中文\nEnglish "] } },
  });
  for (const bad of [
    {},
    { answers: [] },
    { answers: [value.answers[0], value.answers[0]] },
    { answers: [{ questionId: "a", optionIds: ["2"] }, value.answers[1]] },
    { answers: [{ questionId: "a", optionIds: ["0", "1"] }, value.answers[1]] },
    {
      answers: [
        { questionId: "a", optionIds: ["0"], text: "custom" },
        value.answers[1],
      ],
    },
    {
      answers: [
        value.answers[0],
        { questionId: "b", optionIds: [], text: " \n " },
      ],
    },
    {
      answers: [
        ...value.answers,
        { questionId: "extra", optionIds: [], text: "x" },
      ],
    },
  ])
    assert.throws(
      () => validateQuestionAnswer(form, bad),
      (e: any) => e.code === "INVALID_ANSWER",
    );
  const restricted = questionForm("item/tool/requestUserInput", {
    questions: [{ ...params.questions[0], isOther: false }],
  })!;
  assert.throws(() =>
    validateQuestionAnswer(restricted, {
      answers: [{ questionId: "a", optionIds: [], text: "x" }],
    }),
  );
  const input = {
    questions: [
      {
        question: "多选",
        header: "测试",
        multiSelect: true,
        options: params.questions[0].options,
      },
    ],
    metadata: { source: "fixture" },
  };
  const claude = questionForm("AskUserQuestion", { input })!;
  const multi = validateQuestionAnswer(claude, {
    answers: [{ questionId: "0", optionIds: ["1", "0"], text: "其他\n答案" }],
  });
  assert.deepEqual(nativeQuestionAnswer(claude, { input }, multi), {
    approve: true,
    updatedInput: { ...input, answers: { 多选: "A, B, 其他\n答案" } },
  });
});

/** 使用真实环境 SQLite 验证持久化与并发；原生回调由可控 Promise 模拟传输时序。 */
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "relay-questions-"));
  const store = new ConnectorStore(join(dir, "environment.db"));
  const engine = new Engine(
    store,
    () => ({ roots: [] }),
    () => {},
    async () => ({}),
  );
  store.put("localSessions", { runtime: "codex", title: "fixture" }, "session");
  const records = ["one", "two"].map((id) => ({
    id,
    executionId: "execution",
    sessionId: "session",
    nativeId: id,
    form,
    status: "waiting",
  }));
  store.put(
    "localExecutions",
    {
      sessionId: "session",
      status: "waiting",
      interactions: records.map((q) => ({
        ...q,
        method: "item/tool/requestUserInput",
        params,
      })),
      questionRecords: records,
      events: [],
      sequence: 0,
    },
    "execution",
  );
  const request = (id = "one", answer: any = value) => ({
    executionId: "execution",
    interactionId: id,
    answer,
  });
  return {
    store,
    engine,
    request,
    close() {
      engine.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test("并发相同/不同答案、防重对账、刷新历史与其他等待保持", async () => {
  const f = fixture();
  let calls = 0;
  let release!: () => void;
  (f.engine as any).answers.set("one", () => {
    calls++;
    return new Promise<void>((r) => (release = r));
  });
  (f.engine as any).answers.set("two", () => {
    calls++;
  });
  try {
    await assert.rejects(
      f.engine.call("interaction.answer", f.request("one", {})),
    );
    assert.equal(calls, 0);
    const first = f.engine.call("interaction.answer", f.request());
    const duplicate = await f.engine.call("interaction.answer", f.request());
    assert.equal(duplicate.record.status, "submitting");
    await assert.rejects(
      f.engine.call(
        "interaction.answer",
        f.request("one", {
          answers: [{ questionId: "a", optionIds: ["1"] }, value.answers[1]],
        }),
      ),
      (e: any) => e.code === "ANSWER_CONFLICT",
    );
    release();
    assert.equal((await first).record.status, "answered");
    assert.equal(
      (await f.engine.call("interaction.answer", f.request())).ok,
      true,
    );
    assert.equal(calls, 1);
    assert.equal(f.store.get("localExecutions", "execution").status, "waiting");
    const result = await f.engine.call("interaction.status", f.request());
    assert.deepEqual(result.record.answer, value);
    const history = await f.engine.call("session.history", {
      sessionId: "session",
    });
    assert.equal(history.questionRecords.length, 2);
    assert.equal(history.questionRecords[0].status, "answered");
    assert.equal(history.interactions.length, 1);
    await f.engine.call("interaction.answer", f.request("two"));
    assert.equal(calls, 2);
    assert.equal(f.store.get("localExecutions", "execution").status, "running");
    // 已答内容在连接器重启后仍为只读结果。
    const restarted = new Engine(
      f.store,
      () => ({ roots: [] }),
      () => {},
      async () => ({}),
    );
    assert.equal(
      (await restarted.call("interaction.status", f.request())).record.status,
      "answered",
    );
    restarted.close();
  } finally {
    f.close();
  }
});

test("传输结果未知不重放、跨执行拒绝、原生取消与重启失效", async () => {
  const f = fixture();
  let calls = 0;
  (f.engine as any).answers.set("one", () => {
    calls++;
    throw new Error("transport");
  });
  (f.engine as any).answers.set("two", () => {
    calls++;
  });
  try {
    const response = await f.engine.call("interaction.answer", f.request());
    assert.equal(response.record.status, "unknown");
    assert.equal(response.ok, false);
    await f.engine.call("interaction.answer", f.request());
    assert.equal(calls, 1);
    f.store.put(
      "localExecutions",
      { status: "running", interactions: [], questionRecords: [] },
      "other",
    );
    await assert.rejects(
      f.engine.call("interaction.answer", {
        ...f.request(),
        executionId: "other",
      }),
    );
    (f.engine as any).enqueueEvent(
      "execution",
      "session",
      "serverRequest/resolved",
      { requestId: "two" },
    );
    f.engine.flushEvents();
    assert.equal(
      (await f.engine.call("interaction.status", f.request("two"))).record
        .status,
      "invalidated",
    );
    await assert.rejects(f.engine.call("interaction.answer", f.request("two")));
    assert.equal(calls, 1);
    const restarted = new Engine(
      f.store,
      () => ({ roots: [] }),
      () => {},
      async () => ({}),
    );
    assert.equal(
      (await restarted.call("interaction.status", f.request())).record.status,
      "invalidated",
    );
    restarted.close();
  } finally {
    f.close();
  }
});

test("停止与终态阻止旧答案，其他请求仍按各自原生 ID 失效", async () => {
  for (const state of ["stopping", "completed", "cancelled", "failed"]) {
    const f = fixture();
    (f.engine as any).answers.set("one", () => assert.fail("不得回传"));
    try {
      (f.engine as any).state("execution", state);
      await assert.rejects(
        f.engine.call("interaction.answer", f.request()),
        (e: any) => e.code === "STALE_INTERACTION",
      );
      assert.equal(
        (await f.engine.call("interaction.status", f.request())).record.status,
        "invalidated",
      );
    } finally {
      f.close();
    }
  }
});

test("HTTP 认证、同源、旧连接器能力与执行环境路由；服务端不保存问答正文", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { passwordHash } = await import("../src/server/security.js");
  const { randomUUID } = await import("node:crypto");
  const dir = mkdtempSync(join(tmpdir(), "relay-question-api-"));
  const origin = "http://localhost:3180";
  const { app, store, service } = await createApp({
    dataDir: dir,
    publicUrl: origin,
    secureCookie: false,
  });
  try {
    store.put(
      "users",
      { username: "fixture", password: passwordHash("fixture-only-password") },
      "owner",
    );
    const env = store.put("environments", {
      name: "fixture",
      approved: true,
      capabilities: [],
    });
    const session = store.put("sessions", {
      environmentId: env.id,
      status: "waiting",
    });
    const executionId = randomUUID(),
      interactionId = randomUUID();
    store.db
      .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
      .run(
        executionId,
        null,
        session.id,
        env.id,
        "waiting",
        "{}",
        new Date().toISOString(),
      );
    const login = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { origin },
      payload: { username: "fixture", password: "fixture-only-password" },
    });
    const cookie = login.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
    const url = `/api/executions/${executionId}/interactions/${interactionId}`;
    assert.equal((await app.inject(url)).statusCode, 401);
    const unsupported = await app.inject({
      url,
      headers: { cookie, "accept-language": "en" },
    });
    assert.equal(unsupported.statusCode, 409);
    assert.match(unsupported.body, /Upgrade/);
    store.put("environments", { capabilities: ["user-questions-v1"] }, env.id);
    const calls: any[] = [];
    const record = {
      id: interactionId,
      executionId,
      sessionId: session.id,
      form: {
        ...form,
        questions: [{ ...form.questions[0], question: "x".repeat(40000) }],
      },
      status: "answered",
      answer: value,
    };
    service.peers.set(env.id, {
      call: async (method: string, p: any) => {
        calls.push({ method, p });
        return method === "session.history"
          ? { questionRecords: [record] }
          : { ok: true, record };
      },
    } as any);
    assert.equal(
      (await app.inject({ url, headers: { cookie } })).json().record.id,
      interactionId,
    );
    assert.deepEqual(calls[0], {
      method: "interaction.status",
      p: { executionId, interactionId },
    });
    const request = {
      method: "POST" as const,
      url: `/api/executions/${executionId}/answer`,
      payload: { interactionId, answer: value },
    };
    assert.equal(
      (
        await app.inject({
          ...request,
          headers: { cookie, origin: "https://evil.invalid" },
        })
      ).statusCode,
      403,
    );
    assert.equal(
      (await app.inject({ ...request, headers: { cookie, origin } }))
        .statusCode,
      200,
    );
    assert.deepEqual(calls.at(-1), {
      method: "interaction.answer",
      p: { executionId, interactionId, answer: value },
    });
    const history = (
      await app.inject({
        url: `/api/sessions/${session.id}/history`,
        headers: { cookie },
      })
    ).json();
    assert.equal(
      history.questionRecords[0].form.questions[0].question.length,
      40000,
    );
    assert.equal(store.list("localExecutions").length, 0);
    assert.equal(
      JSON.stringify(store.get("sessions", session.id)).includes("English"),
      false,
    );
    assert.equal(
      (
        await app.inject({
          url: `/api/executions/${randomUUID()}/interactions/${interactionId}`,
          headers: { cookie },
        })
      ).statusCode,
      404,
    );
    service.peers.delete(env.id);
    assert.equal(
      (await app.inject({ url, headers: { cookie } })).statusCode,
      409,
    );
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("真实执行线程及 RPC 保留题号、双语错误键与冲突状态", async () => {
  const { EngineClient } = await import("../src/connector/engine-client.js");
  const { RpcPeer } = await import("../src/shared/rpc.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-question-thread-"));
  const store = new ConnectorStore(join(dir, "environment.db"));
  store.put(
    "localExecutions",
    {
      status: "completed",
      interactions: [],
      questionRecords: [{ id: "one", form, status: "answered", answer: value }],
    },
    "execution",
  );
  store.close();
  const client = new EngineClient(
    dir,
    () => {},
    async () => ({}),
    () => {},
  );
  const server = new RpcPeer(
    (raw) => void peer.receive(raw),
    (method, params) => client.call(method, params),
  );
  const peer = new RpcPeer(
    (raw) => void server.receive(raw),
    async () => ({}),
  );
  try {
    await assert.rejects(
      peer.call("interaction.answer", {
        executionId: "execution",
        interactionId: "one",
        answer: {},
      }),
      (e: any) =>
        e.code === "INVALID_ANSWER" &&
        e.messageKey === "questions.invalid" &&
        e.messageParams.question === 0 &&
        errorBody(e, "en").message.includes("question 0"),
    );
    await assert.rejects(
      peer.call("interaction.answer", {
        executionId: "execution",
        interactionId: "one",
        answer: {
          answers: [{ questionId: "a", optionIds: ["1"] }, value.answers[1]],
        },
      }),
      (e: any) =>
        e.code === "ANSWER_CONFLICT" &&
        e.status === 409 &&
        e.messageKey === "questions.conflict",
    );
  } finally {
    peer.close();
    server.close();
    await client.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("提交等待原生回执期间停止，迟到回执不撤销停止状态", async () => {
  const f = fixture();
  let release!: () => void;
  (f.engine as any).answers.set(
    "one",
    () => new Promise<void>((r) => (release = r)),
  );
  try {
    const answer = f.engine.call("interaction.answer", f.request());
    (f.engine as any).state("execution", "stopping");
    release();
    assert.equal((await answer).record.status, "answered");
    assert.equal(
      f.store.get("localExecutions", "execution").status,
      "stopping",
    );
  } finally {
    f.close();
  }
});

test("终态落盘后崩溃也使未确认回答失效，已接受的答案仍保留", async () => {
  const f = fixture();
  try {
    const e = f.store.get("localExecutions", "execution");
    f.store.put(
      "localExecutions",
      {
        status: "completed",
        interactions: [],
        questionRecords: e.questionRecords.map((q: any, i: number) => ({
          ...q,
          status: i ? "answered" : "submitting",
          answer: value,
        })),
      },
      e.id,
    );
    const restarted = new Engine(
      f.store,
      () => ({ roots: [] }),
      () => {},
      async () => ({}),
    );
    assert.equal(
      (await restarted.call("interaction.status", f.request())).record.status,
      "invalidated",
    );
    assert.equal(
      (await restarted.call("interaction.status", f.request("two"))).record
        .status,
      "answered",
    );
    assert.equal(
      f.store.get("localExecutions", "execution").status,
      "completed",
    );
    restarted.close();
  } finally {
    f.close();
  }
});

test("原生停止先拒绝未确认回执，迟到 resolved 不能伪报接收成功", async () => {
  const { CodexRuntime, ClaudeRuntime } =
    await import("../src/connector/runtime.js");
  for (const Type of [CodexRuntime, ClaudeRuntime]) {
    const runtime = Object.create(Type.prototype) as any;
    if (Type === CodexRuntime) runtime.asyncQuestions = new Set();
    let rejected = 0;
    runtime.questionReceipts = new Map([
      [
        "request",
        {
          resolve: () => assert.fail("停止不能确认答案"),
          reject: () => {
            rejected++;
          },
        },
      ],
    ]);
    runtime.abort = new AbortController();
    runtime.turnId = "turn";
    runtime.call = async () => assert.equal(rejected, 1);
    await runtime.cancel();
    assert.equal(rejected, 1);
    assert.equal(runtime.questionReceipts.size, 0);
  }
});
