import { rm } from "node:fs/promises";
import { boardInstruction, boardTools } from "../src/shared/session-boards.js";
import { classifyApproval } from "../src/shared/permission-policy.js";
import {
  questionForm,
  validateQuestionAnswer,
  nativeQuestionAnswer,
} from "../src/shared/user-questions.js";
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexRuntime } from "../src/connector/runtime.js";
import { historyEvents } from "../src/shared/session-events.js";
import type { QuestionRecord } from "../src/shared/user-questions.js";
/** 真实 Codex 二进制连接本地假 Responses 端点，使用全新 CODEX_HOME，不读取用户授权。 */
for (const mode of [
  "plain",
  "board",
  "approval",
  "approval-auto",
  "handoff",
  "empty",
  "question",
  "question-full",
  "question-async",
  "question-async-idle",
]) {
  const question = mode.startsWith("question");
  const approval = mode.startsWith("approval");
  const asyncQuestion = mode.startsWith("question-async");
  const model = asyncQuestion ? "gpt-6-astra" : "fixture-override";
  const handoff = mode === "handoff";
  const empty = mode === "empty";
  const locale = handoff ? "en" : "zh-CN";
  test(
    "Codex app-server 真实线程、流式历史 / " + mode,
    { timeout: 40000 },
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "relay-codex-"));
      const home = join(dir, "codex");
      mkdirSync(home);
      const skillPath = join(
        dir,
        ".agents",
        "skills",
        "relay-fixture",
        "SKILL.md",
      );
      mkdirSync(join(dir, ".agents", "skills", "relay-fixture"), {
        recursive: true,
      });
      writeFileSync(
        skillPath,
        "---\nname: relay-fixture\ndescription: fixture verification\n---\nRELAY_SKILL_BODY_SENTINEL\n",
      );
      const mock = Fastify();
      let requests = 0;
      let captured: any;
      const events: any[] = [];
      let approvedItemId: string | undefined;
      let nativeId = "";
      let finalStatus = "";
      let interactions = 0;
      let receipts = 0;
      let answerTurnId: string | undefined;
      let questionRecord: QuestionRecord | undefined;
      let handoffCalls = 0;
      let submit: (() => Promise<void>) | undefined;
      let receivedAnswer: any;
      let firstRequest: any;
      mock.post("/v1/responses", async (req, reply) => {
        requests++;
        captured = req.body;
        firstRequest ??= captured;
        if (asyncQuestion && requests === 2 && mode === "question-async")
          await submit!();
        if (asyncQuestion) {
          const message = captured.input.findLast(
            (entry: any) => entry.role === "user",
          );
          const text = message?.content?.[0]?.text;
          if (text?.startsWith('{"requestId":'))
            receivedAnswer = JSON.parse(text);
        }
        reply.hijack();
        reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
        let sequence_number = 0;
        const emit = (type: string, rest: any) =>
          reply.raw.write(
            "event: " +
              type +
              "\ndata: " +
              JSON.stringify({
                type,
                sequence_number: sequence_number++,
                ...rest,
              }) +
              "\n\n",
          );
        const item = {
          id: "msg_fixture",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [
            { type: "output_text", text: "原生协议测试完成", annotations: [] },
          ],
        };
        const base = {
          id: "resp_fixture",
          object: "response",
          created_at: 1,
          model: "fixture",
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };
        emit("response.created", {
          response: { ...base, status: "in_progress", output: [] },
        });
        if ((approval || handoff || question || mode === "board") && requests === 1) {
          const call = {
            id: "fc_fixture",
            type: "function_call",
            call_id: "call_fixture",
            name: mode === "board" ? "relay_board_references" : asyncQuestion
              ? "request_user_input_async"
              : question
                ? "request_user_input"
                : handoff
                  ? "relay_handoff"
                  : "exec_command",
            arguments: JSON.stringify(
              mode === "board" ? {} : asyncQuestion
                ? {
                    questions: [
                      { title: "选择测试", options: ["A", "B"] },
                      { title: "输入测试" },
                    ],
                  }
                : question
                  ? {
                      questions: [
                        {
                          id: "choice",
                          header: "选择",
                          question: "选择测试",
                          options: [
                            { label: "A", description: "甲" },
                            { label: "B", description: "乙" },
                          ],
                        },
                        {
                          id: "text",
                          header: "文本",
                          question: "输入测试",
                          options: [
                            { label: "C", description: "丙" },
                            { label: "D", description: "丁" },
                          ],
                        },
                      ],
                    }
                  : handoff
                    ? { targetId: "S3", record: "交付" }
                    : {
                        cmd: "printf fixture-approved",
                        sandbox_permissions: "require_escalated",
                        justification: "验证原生审批协议，仅输出测试文本",
                      },
            ),
            status: "completed",
          };
          emit("response.output_item.added", {
            output_index: 0,
            item: { ...call, arguments: "", status: "in_progress" },
          });
          emit("response.function_call_arguments.delta", {
            item_id: call.id,
            output_index: 0,
            delta: call.arguments,
          });
          emit("response.function_call_arguments.done", {
            item_id: call.id,
            output_index: 0,
            arguments: call.arguments,
          });
          emit("response.output_item.done", { output_index: 0, item: call });
          emit("response.completed", {
            response: { ...base, status: "completed", output: [call] },
          });
          reply.raw.end();
          return;
        }
        emit("response.output_item.added", {
          output_index: 0,
          item: { ...item, content: [], status: "in_progress" },
        });
        emit("response.content_part.added", {
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        });
        emit("response.output_text.delta", {
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          delta: "原生协议测试完成",
        });
        emit("response.output_text.done", {
          item_id: item.id,
          output_index: 0,
          content_index: 0,
          text: "原生协议测试完成",
        });
        emit("response.output_item.done", { output_index: 0, item });
        emit("response.completed", {
          response: { ...base, status: "completed", output: [item] },
        });
        reply.raw.end();
      });
      await mock.listen({ host: "127.0.0.1", port: 0 });
      const address = mock.server.address() as any;
      const runtime = new CodexRuntime(
        {
          event: (type, data) => {
            events.push({ type, data });
            if (
              mode === "question-async-idle" &&
              type === "turn/completed" &&
              submit &&
              !receipts
            )
              setImmediate(() => void submit!());
          },
          native: (id) => (nativeId = id),
          interaction: (id, method, params, answer) => {
            interactions++;
            if (question) {
              assert.equal(
                method,
                asyncQuestion
                  ? "request_user_input_async"
                  : "item/tool/requestUserInput",
              );
              if (asyncQuestion) assert.equal(id, "call_fixture");
              assert.equal(params.questions.length, 2);
              const form = questionForm(method, params)!;
              assert.equal(form.supported, true);
              if (asyncQuestion) {
                assert.deepEqual(
                  form.questions.map((q) => q.question),
                  ["选择测试", "输入测试"],
                );
                assert.deepEqual(
                  form.questions[0].options.map((o) => o.label),
                  ["A", "B"],
                );
                assert.equal(form.questions[0].allowText, true);
                assert.equal(form.questions[1].options.length, 0);
              }
              assert.equal(form.questions[1].allowText, true);
              const response = validateQuestionAnswer(form, {
                answers: [
                  {
                    questionId: asyncQuestion ? "0" : "choice",
                    optionIds: ["1"],
                  },
                  {
                    questionId: asyncQuestion ? "1" : "text",
                    optionIds: [],
                    text: "中文\nanswer",
                  },
                ],
              });
              submit = async () => {
                const receipt = await answer(
                  nativeQuestionAnswer(form, params, response),
                );
                answerTurnId = receipt?.answerTurnId;
                questionRecord = {
                  id: "card",
                  executionId: "run",
                  sessionId: "session",
                  nativeId: id,
                  questionItemId: id,
                  form,
                  answer: response,
                  answerTurnId,
                  status: "answered",
                };
                receipts++;
              };
              if (!asyncQuestion) void submit();
            } else {
              assert.equal(method, "item/commandExecution/requestApproval");
              approvedItemId = params.itemId;
              const policy = classifyApproval(method, params);
              assert.ok(policy);
              void answer(mode === "approval-auto" ? policy.answer : { decision: "accept" });
            }
          },
          done: (status) => (finalStatus = status),
          board: async (tool, args, callId) => {
            assert.equal(tool, "references");
            assert.deepEqual(args, {});
            assert.ok(callId);
            return { boards: [], verifiedBoardCall: true };
          },
          light: async () => ({}),
          handoff: async (args) => {
            handoffCalls++;
            assert.deepEqual(args, { targetId: "S3", record: "交付" });
            return { ok: true };
          },
        },
        {
          home,
          baseUrl: `http://127.0.0.1:${address.port}/v1`,
          apiKey: "fixture-not-real",
          model: "fixture",
        },
      );
      try {
        await runtime.start(
          dir,
          {
            boardTools: mode === "board",
            initialSessionTitle: handoff ? "工作项-开发" : undefined,
            runtimeOptions: { model, effort: "high" },
            permission: mode === "question-full" ? "full" : mode === "approval-auto" ? "auto" : "ask",
            agent: {
              injection: "append",
              instructions: "仅完成协议验证，不操作文件。",
            },
          },
          mode === "board" ? "@relay-fixture @Board 返回一行验证文本" : "@relay-fixture 返回一行验证文本",
          {
            instructions: "测试看板工具注册",
            title: "fixture",
            targets: ["fixture-target"],
            locale,
            handoffContractVersion: 2,
            currentStage: { shortId: "S1", name: "执行", type: "agent" },
            allowedTargets: empty
              ? []
              : [{ shortId: "S3", name: "审核", type: "human" }],
            handoffs: [
              {
                record: "user-original",
                attachments: [{ name: "report.md", path: "folder/report.md" }],
                artifacts: [{ name: "report.md" }],
              },
            ],
            allowArtifacts: approval,
          },
          undefined,
          [
            {
              kind: "skill",
              name: "relay-fixture",
              path: skillPath,
              start: 0,
              end: 14,
            },
            ...(mode === "board" ? [{ kind: "board" as const, name: "Board", path: "selected-board", start: 15, end: 21 }] : []),
          ],
        );
        const until = Date.now() + 20000;
        while (!finalStatus && Date.now() < until)
          await new Promise((r) => setTimeout(r, 30));
        assert.equal(
          finalStatus,
          "completed",
          JSON.stringify(events.filter((e) => e.type === "error")),
        );
        assert.equal(captured.model, model);
        assert.equal(captured.reasoning?.effort, "high");
        assert.ok(nativeId);
        assert.equal(
          requests,
          asyncQuestion ? 3 : approval || handoff || question || mode === "board" ? 2 : 1,
        );
        if (asyncQuestion) {
          assert.ok(
            JSON.stringify(firstRequest).includes("request_user_input_async"),
            JSON.stringify(Object.keys(firstRequest)),
          );
          assert.deepEqual(receivedAnswer, {
            requestId: "call_fixture",
            answers: [
              { question: "选择测试", answers: ["B"] },
              { question: "输入测试", answers: ["中文\nanswer"] },
            ],
          });
        }
        if (question) {
          assert.equal(receipts, 1);
          assert.ok(
            JSON.stringify(captured.input).includes("中文"),
            JSON.stringify(captured.input).slice(-5000),
          );
          assert.ok(JSON.stringify(captured.input).includes("call_fixture"));
        }
        if (mode === "board") {
          assert.equal(JSON.stringify(firstRequest).split(boardInstruction).length, 2);
          for (const name of Object.keys(boardTools))
            assert.ok(firstRequest.tools.some((t: any) => t.name === "relay_board_" + name));
          assert.ok(JSON.stringify(captured.input).includes("verifiedBoardCall"));
        }
        assert.equal(handoffCalls, handoff ? 1 : 0);
        assert.equal(interactions, approval || question ? 1 : 0);
        if (mode === "plain")
          assert.ok(firstRequest.tools.some((tool: any) => tool.name === "relay_light_feedback"));
        if (approval)
          assert.ok(firstRequest.tools.some((tool: any) => tool.name === "relay_light_publish"));
        if (!asyncQuestion) {
          assert.ok(firstRequest.tools.some((t:any) => t.name === "relay_light_versions"));
          for (const name of ["relay_light_docs", "relay_light_unlist", "relay_light_delete"])
            assert.equal(firstRequest.tools.some((t:any) => t.name === name), approval);
        }
        assert.ok(JSON.stringify(firstRequest).includes("You are connected to the user through BugPaw Relay"));
        if (approval) {
          const schema = firstRequest.tools.find((t:any) => t.name === "relay_light_publish").parameters;
          assert.ok(!Object.hasOwn(schema.properties, "operationId"));
        }
        const handoffTool = firstRequest.tools?.find(
          (t: any) => t.name === "relay_handoff",
        );
        if (empty) assert.equal(handoffTool, undefined);
        else if (!asyncQuestion) {
          assert.ok(handoffTool);
          assert.deepEqual(handoffTool.parameters.properties.targetId.enum, [
            "S3",
          ]);
          assert.equal(!!handoffTool.parameters.properties.artifacts, approval);
        }
        {
          assert.ok(
            JSON.stringify(captured.input).includes(
              locale === "en" ? "## Current stage" : "## 当前阶段",
            ),
          );
          assert.ok(
            !JSON.stringify(captured.input).includes(
              "当前阶段 / Current stage",
            ),
          );
          assert.ok(
            JSON.stringify(captured.input).includes(
              locale === "en"
                ? "Project directory attachments"
                : "项目目录附件",
            ),
          );
          assert.ok(
            JSON.stringify(captured.input).includes("folder/report.md"),
          );
          assert.ok(JSON.stringify(captured.input).includes("S1"));
        }
        if (!empty)
          assert.ok(
            JSON.stringify(captured.input).includes(
              locale === "en"
                ? "Call relay_handoff"
                : "完成后调用 relay_handoff",
            ),
          );
        assert.ok(
          JSON.stringify(captured.input).includes("RELAY_SKILL_BODY_SENTINEL"),
        );
        assert.ok(events.some((e) => e.type === "item/agentMessage/delta"));
        const history = await runtime.history();
        if (approval) {
          assert.ok(approvedItemId);
          assert.ok(history.thread.turns.some((turn: any) => turn.items.some((item: any) =>
            item.id === approvedItemId && item.type === "commandExecution")));
          assert.ok(events.some(e => e.data.item?.id === approvedItemId &&
            e.data.item.type === "commandExecution"));
        }
        if (mode === "board") {
          const text = "@relay-fixture @Board 返回一行验证文本";
          const nativeText = "$relay-fixture @Board (boardId=selected-board) 返回一行验证文本";
          assert.ok(JSON.stringify(firstRequest.input).includes(nativeText));
          const rows = historyEvents({ nativeHistory: history, events: [
            { type: "user", executionId: "fixture", sequence: 1, data: { text, nativeText } },
            ...events.map((event, index) => ({ ...event, executionId: "fixture", sequence: index + 2 })),
          ] });
          assert.deepEqual(rows.filter(row => row.type === "user").map(row => row.data.text), [text]);
          assert.equal(rows[0].type, "user");
        }
        if (handoff) assert.equal(history.thread.name, "工作项-开发");
        if (asyncQuestion) {
          assert.ok(answerTurnId);
          const rows = historyEvents(
            {
              nativeHistory: history,
              events,
              questionRecords: [questionRecord],
            },
            true,
          );
          const card = rows.findIndex((row) => row.type === "question");
          assert.ok(
            card >= 0 &&
              rows
                .slice(card + 1)
                .some((row) =>
                  row.data?.item?.text?.includes("原生协议测试完成"),
                ),
          );
          assert.ok(
            !rows.some(
              (row) =>
                row.type === "user" &&
                row.data.text === JSON.stringify(receivedAnswer),
            ),
          );
          const turn = history.thread.turns.find(
            (t: any) => t.id === answerTurnId,
          );
          assert.ok(
            turn?.items.some(
              (item: any) =>
                item.type === "userMessage" &&
                item.content.some(
                  (part: any) => part.text === JSON.stringify(receivedAnswer),
                ),
            ),
          );
        }
        assert.equal(history.thread.id, nativeId);
        assert.ok(JSON.stringify(history).includes("原生协议测试完成"));
        if (mode === "plain") {
          runtime.close();
          let resumedStatus = "";
          const resumed = new CodexRuntime(
            {
              event: () => {},
              native: () => {},
              interaction: () => {},
              done: (s) => {
                resumedStatus = s;
              },
              board: async () => ({ boards: [] }),
              light: async () => ({apps:[]}),
              handoff: async () => ({}),
            },
            {
              home,
              baseUrl: `http://127.0.0.1:${address.port}/v1`,
              apiKey: "fixture-not-real",
              model: "fixture",
            },
          );
          try {
            await resumed.start(
              dir,
              {
                boardTools: true,
                permission: "ask",
                runtimeOptions: { model: null, effort: null },
              },
              "继续",
              null,
              nativeId,
            );
            const untilResume = Date.now() + 15000;
            while (!resumedStatus && Date.now() < untilResume)
              await new Promise((r) => setTimeout(r, 30));
            assert.equal(resumedStatus, "completed");
            const boardServer = captured.tools.find((t: any) => t.name === "mcp__relay_board");
            assert.ok(boardServer?.tools.some((t: any) => t.name === "relay_board_create"));
            const compatible = captured.tools.find((t:any) => t.name === "mcp__relay_light");
            for (const name of ["relay_light_versions", "relay_light_unlist", "relay_light_delete"])
              assert.ok(compatible.tools.some((tool:any) => tool.name === name));
            assert.equal(captured.model, "fixture");
            assert.notEqual(captured.reasoning?.effort, "high");
          } finally {
            resumed.close();
          }
        }
      } finally {
        runtime.close();
        await mock.close();
        // 原生子进程关闭后可能短暂落盘，允许清理重试而不掩盖协议断言。
        await rm(dir, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 100,
        });
      }
    },
  );
}

/** 协议外诊断行可忽略，但业务处理失败要可定位且不暴露原文。 */
test("原生消息处理失败留安全日志，解析失败不误报", (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (line: string) => errors.push(line));
  let calls = 0;
  const runtime = new CodexRuntime(
    {
      event() {
        calls++;
        throw new Error("private-fixture-body");
      },
      native() {},
      interaction() {},
      done() {},
      handoff: async () => ({}),
    },
    { command: process.execPath },
  );
  try {
    const output = (runtime as any).process.stdout;
    output.emit("data", Buffer.from("private-fixture-invalid-json\n"));
    assert.equal(errors.length, 0);
    output.emit(
      "data",
      Buffer.from(
        JSON.stringify({
          method: "test/event",
          params: { text: "private-fixture-body" },
        }) + "\n",
      ),
    );
    assert.equal(calls, 1);
    assert.equal(errors.length, 1);
    assert.equal(JSON.parse(errors[0]!).event, "runtime.message_failed");
    assert.doesNotMatch(errors.join(""), /private-fixture/);
  } finally {
    runtime.close();
  }
});
