import { rm } from "node:fs/promises";
import { boardInstruction, boardTools } from "../src/shared/session-boards.js";
import { classifyApproval } from "../src/shared/permission-policy.js";
import { useInstalledClaudeSdk } from "./claude-sdk-fixture.js";
import {
  questionForm,
  validateQuestionAnswer,
  nativeQuestionAnswer,
} from "../src/shared/user-questions.js";
import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { historyEvents } from "../src/web/session-events.js";
import { loadClaudeSdk } from "../src/connector/claude-sdk.js";
import { ClaudeRuntime } from "../src/connector/runtime.js";
/** 真实 Claude SDK 子进程仅访问本地假端点，隔离凭据目录且不使用订阅。 */
for (const mode of [
  "plain",
  "board",
  "question",
  "question-full",
  "question-auto",
  "handoff",
  "artifact",
  "empty",
  "invalid",
]) {
  const question = mode.startsWith("question");
  const workflowEnabled =
    mode === "handoff" || mode === "artifact" || mode === "invalid";
  const withArtifacts = mode === "artifact";
  const locale = withArtifacts ? "en" : "zh-CN";
  test("Claude SDK 真实流式协议 / " + mode, { timeout: 40000 }, async (t) => {
    const dir = mkdtempSync(join(tmpdir(), "relay-claude-"));
    const home = join(dir, "claude");
    mkdirSync(home);
    if (mode === "artifact" || mode === "board") {
      const previous = process.env.CLAUDE_CONFIG_DIR;
      process.env.CLAUDE_CONFIG_DIR = home;
      t.after(() => {
        if (previous === undefined) delete process.env.CLAUDE_CONFIG_DIR;
        else process.env.CLAUDE_CONFIG_DIR = previous;
      });
    }
    if (mode === "plain") {
      // 用户已有其他供应商时，会话仍须访问连接器端点并使用连接器凭据。
      writeFileSync(
        join(home, "settings.json"),
        JSON.stringify({
          env: {
            ANTHROPIC_BASE_URL: "http://127.0.0.1:1",
            ANTHROPIC_AUTH_TOKEN: "fixture-user-token",
          },
        }),
      );
    }
    if (mode === "question-auto")
      writeFileSync(join(home, "settings.json"), JSON.stringify({ permissions: { ask: ["Write"] } }));
    const skillDir = join(dir, ".claude", "skills", "relay-fixture");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      "---\nname: relay-fixture\ndescription: fixture verification\n---\nRELAY_CLAUDE_SKILL_SENTINEL\n",
    );
    let captured: any;
    const registeredTools: any[] = [];
    // 禁用延迟发现，仅在隔离测试中直接检查发往模型的完整工具 schema。
    process.env.ENABLE_TOOL_SEARCH = "false";
    const mock = Fastify();
    let requests = 0;
    let boardCallRequested = false;
    let boardResultSeen = false;
    let handoffCalls = 0;
    let handoffSent = 0;
    let nativeId = "";
    let finalStatus = "";
    let interactions = 0;
    let receipts = 0;
    const events: any[] = [];
    mock.post("/v1/messages", async (req, reply) => {
      if (mode === "plain") {
        assert.equal(req.headers["x-api-key"], "fixture-not-real");
        assert.equal(req.headers.authorization, undefined);
      }
      requests++;
      captured = req.body;
      registeredTools.push(...(captured.tools || []));
      if (mode === "board" && JSON.stringify(captured.messages).includes("verifiedBoardCall"))
        boardResultSeen = true;

      reply.hijack();
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      const emit = (type: string, rest: any) =>
        reply.raw.write(
          "event: " +
            type +
            "\ndata: " +
            JSON.stringify({ type, ...rest }) +
            "\n\n",
        );
      emit("message_start", {
        message: {
          id: "msg_fixture_" + requests,
          type: "message",
          role: "assistant",
          content: [],
          model: "fixture",
          stop_reason: null,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      });
      if ((mode === "question-auto" && requests === 1) ||
        (mode === "board" && !boardCallRequested && captured.tools?.some((tool: any) =>
          tool.name === "mcp__relay__board_references") && JSON.stringify(captured.messages).includes("@Board (boardId=selected-board)"))) {
        if (mode === "board") boardCallRequested = true;
        // 用隔离临时文件触发真实 CLI 工具审批，随后在同一执行中发起真实提问。
        emit("content_block_start", { index: 0, content_block: {
          type: "tool_use", id: "write_fixture", name: mode === "board" ? "mcp__relay__board_references" : "Write", input: {},
        } });
        emit("content_block_delta", { index: 0, delta: { type: "input_json_delta",
          partial_json: JSON.stringify(mode === "board" ? {} : { file_path: join(dir, "proof.txt"), content: "verified" }),
        } });
        emit("content_block_stop", { index: 0 });
        emit("message_delta", { delta: { stop_reason: "tool_use", stop_sequence: null }, usage: { output_tokens: 20 } });
        emit("message_stop", {});
        reply.raw.end();
        return;
      }
      if (question && requests === (mode === "question-auto" ? 2 : 1)) {
        const input = {
          questions: [
            {
              question: "选择测试选项",
              header: "测试",
              options: [
                { label: "A", description: "测试 A" },
                { label: "B", description: "测试 B" },
              ],
              multiSelect: true,
            },
            {
              question: "单选测试",
              header: "单选",
              options: [
                { label: "C", description: "丙" },
                { label: "D", description: "丁" },
              ],
              multiSelect: false,
            },
            {
              question: "自定义测试",
              header: "文本",
              options: [
                { label: "E", description: "戊" },
                { label: "F", description: "己" },
              ],
              multiSelect: false,
            },
          ],
        };
        emit("content_block_start", {
          index: 0,
          content_block: {
            type: "tool_use",
            id: "tool_fixture",
            name: "AskUserQuestion",
            input: {},
          },
        });
        emit("content_block_delta", {
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(input),
          },
        });
        emit("content_block_stop", { index: 0 });
        emit("message_delta", {
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 20 },
        });
        emit("message_stop", {});
        reply.raw.end();
        return;
      }
      if (
        workflowEnabled &&
        handoffSent < (mode === "invalid" ? 2 : 1) &&
        captured.tools?.some((t: any) => t.name === "mcp__relay__handoff")
      ) {
        handoffSent++;
        const searching = false;
        emit("content_block_start", {
          index: 0,
          content_block: {
            type: "tool_use",
            id: "handoff_fixture",
            name: searching ? "ToolSearch" : "mcp__relay__handoff",
            input: {},
          },
        });
        emit("content_block_delta", {
          index: 0,
          delta: {
            type: "input_json_delta",
            partial_json: JSON.stringify(
              searching
                ? { query: "select:mcp__relay__handoff", max_results: 1 }
                : {
                    targetId:
                      mode === "invalid" && handoffSent === 1 ? "S99" : "S3",
                    record: "交付",
                    ...(withArtifacts
                      ? { artifacts: [{ path: "report.md", name: "报告" }] }
                      : {}),
                  },
            ),
          },
        });
        emit("content_block_stop", { index: 0 });
        emit("message_delta", {
          delta: { stop_reason: "tool_use", stop_sequence: null },
          usage: { output_tokens: 20 },
        });
        emit("message_stop", {});
        reply.raw.end();
        return;
      }
      emit("content_block_start", {
        index: 0,
        content_block: { type: "text", text: "" },
      });
      emit("content_block_delta", {
        index: 0,
        delta: { type: "text_delta", text: "Claude 原生协议测试完成" },
      });
      emit("content_block_stop", { index: 0 });
      emit("content_block_start", {
        index: 1,
        content_block: { type: "text", text: "" },
      });
      emit("content_block_delta", {
        index: 1,
        delta: { type: "text_delta", text: "第二段回答仍须保留" },
      });
      emit("content_block_stop", { index: 1 });
      emit("message_delta", {
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 5 },
      });
      emit("message_stop", {});
      reply.raw.end();
    });
    await mock.listen({ host: "127.0.0.1", port: 0 });
    const address = mock.server.address() as any;
    const runtime = new ClaudeRuntime(
      {
        event: (type, data) => events.push({ type, data }),
        native: (id) => (nativeId = id),
        interaction: (id, method, params, answer) => {
          interactions++;
          if (mode === "question-auto" && method === "Write") {
            assert.equal(params.itemId, "write_fixture");
            const approval = classifyApproval(method, params);
            assert.ok(approval);
            void answer(approval.answer);
            return;
          }
          assert.equal(classifyApproval(method, params), null);
          assert.equal(method, "AskUserQuestion");
          const form = questionForm(method, params)!;
          const response = validateQuestionAnswer(form, {
            answers: [
              { questionId: "0", optionIds: ["0", "1"], text: "中文\nanswer" },
              { questionId: "1", optionIds: ["1"] },
              { questionId: "2", optionIds: [], text: "自由输入" },
            ],
          });
          void Promise.resolve(
            answer(nativeQuestionAnswer(form, params, response)),
          ).then(() => {
            receipts++;
          });
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
          assert.deepEqual(args, {
            targetId: "S3",
            record: "交付",
            ...(withArtifacts
              ? { artifacts: [{ path: "report.md", name: "报告" }] }
              : {}),
          });
          return { ok: true };
        },
      },
      {
        home,
        baseUrl: `http://127.0.0.1:${address.port}`,
        apiKey: "fixture-not-real",
        model: "fixture",
      },
    );
    try {
      await runtime.start(
        dir,
        {
          initialSessionTitle: mode === "artifact" ? "工作项-开发" : undefined,
          boardTools: mode === "board",
          runtimeOptions: {
            model: "claude-sonnet-4-6",
            effort: "low",
            thinking: { type: "adaptive" },
          },
          permission: mode === "question-full" ? "full" : mode === "question-auto" ? "auto" : "ask",
          agent: {
            injection: "append",
            instructions: "仅返回测试文本，不操作文件。",
          },
        },
        mode === "plain" ? "@relay-fixture 返回测试文本" : mode === "board" ? "@Board 返回测试文本" : "返回测试文本",
        workflowEnabled || mode === "empty"
          ? {
              manualContinuation: mode === "handoff",
              title: "交接工具",
              instructions: "验证工具注册",
              targets: [],
              locale,
              handoffContractVersion: 2,
              currentStage: { shortId: "S1", name: "执行", type: "agent" },
              allowedTargets:
                mode === "empty"
                  ? []
                  : [{ shortId: "S3", name: "审核", type: "human" }],
              handoffs: [
                {
                  record: "user-original",
                  attachments: [
                    { name: "report.md", path: "folder/report.md" },
                  ],
                  artifacts: [{ name: "report.md" }],
                },
              ],
              allowArtifacts: withArtifacts,
            }
          : null,
        undefined,
        mode === "plain"
          ? [
              {
                kind: "skill",
                name: "relay-fixture",
                path: "relay-fixture",
                start: 0,
                end: 14,
              },
            ]
          : mode === "board" ? [{ kind: "board", name: "Board", path: "selected-board", start: 0, end: 6 }] : [],
      );
      const until = Date.now() + 25000;
      while (!finalStatus && Date.now() < until)
        await new Promise((r) => setTimeout(r, 50));
      assert.equal(
        finalStatus,
        "completed",
        JSON.stringify(events.filter((e) => e.type === "result")),
      );
      assert.ok(JSON.stringify(captured.system).includes("In BugPaw Relay, a “Light App”"));
      if (mode === "board") {
        const text = "@Board 返回测试文本";
        const nativeText = "@Board (boardId=selected-board) 返回测试文本";
        assert.ok(JSON.stringify(captured.messages).includes(nativeText));
        const nativeHistory = await (await loadClaudeSdk()).getSessionMessages(nativeId, { dir });
        assert.ok(nativeHistory.some(message => message.type === "user"));
        const rows = historyEvents({ nativeHistory, events: [
          { type: "user", executionId: "fixture", sequence: 1, data: { text, nativeText } },
          ...events.map((event, index) => ({ ...event, executionId: "fixture", sequence: index + 2 })),
        ] });
        assert.deepEqual(rows.filter(row => row.type === "user").map(row => row.data.text), [text]);
        assert.equal(rows[0].type, "user");
        assert.equal(JSON.stringify(captured.system).split(boardInstruction).length, 2);
        for (const name of Object.keys(boardTools))
          assert.ok(registeredTools.some(tool => tool.name === "mcp__relay__board_" + name));
        assert.ok(boardResultSeen);
      }
      assert.equal(captured.model, "claude-sonnet-4-6");
      assert.equal(captured.output_config?.effort, "low");
      assert.equal(captured.thinking?.type, "adaptive");
      assert.ok(nativeId);
      if (mode === "artifact")
        assert.equal((await (await loadClaudeSdk()).getSessionInfo(nativeId, { dir }))?.customTitle, "工作项-开发");
      assert.ok(requests >= 1);
      if (mode === "plain")
        assert.ok(
          JSON.stringify(captured.messages).includes(
            "RELAY_CLAUDE_SKILL_SENTINEL",
          ),
        );
      assert.equal(
        handoffCalls,
        workflowEnabled ? 1 : 0,
        JSON.stringify(events.filter((e) => e.type === "result")),
      );
      if (mode === "plain")
        for (const name of ["light_docs", "light_publish", "light_unlist", "light_delete"])
          assert.ok(registeredTools.some(tool => tool.name === "mcp__relay__" + name));
      if (mode === "empty")
        assert.ok(
          !registeredTools.some((t) => t.name === "mcp__relay__handoff"),
        );
      if (mode === "handoff") {
        const blocks = captured.messages.flatMap((m: any) => m.content);
        assert.ok(blocks.some((b: any) => b.text === "返回测试文本"));
        assert.ok(!JSON.stringify(blocks).includes("## 当前阶段"));
      } else if (workflowEnabled || mode === "empty") {
        assert.ok(
          JSON.stringify(captured.messages).includes(
            locale === "en" ? "## Current stage" : "## 当前阶段",
          ),
        );
        assert.ok(
          !JSON.stringify(captured.messages).includes(
            "当前阶段 / Current stage",
          ),
        );
        assert.ok(
          JSON.stringify(captured.messages).includes(
            locale === "en" ? "Project directory attachments" : "项目目录附件",
          ),
        );
        assert.ok(
          JSON.stringify(captured.messages).includes("folder/report.md"),
        );
        assert.ok(JSON.stringify(captured.messages).includes("S1"));
      }
      if (workflowEnabled) {
        const handoffTool = registeredTools.find(
          (t) => t.name === "mcp__relay__handoff",
        );
        assert.deepEqual(
          handoffTool?.input_schema.properties.targetId.enum,
          ["S3"],
          JSON.stringify(registeredTools.filter((t) => /handoff/.test(t.name))),
        );
      }
      if (workflowEnabled)
        assert.ok(
          events.some(
            (e) =>
              e.type === "system" &&
              e.data.tools?.includes("mcp__relay__handoff"),
          ),
        );
      if (mode === "question-auto") assert.equal(readFileSync(join(dir, "proof.txt"), "utf8"), "verified");
      assert.equal(interactions, mode === "question-auto" ? 2 : question ? 1 : 0);
      if (question) {
        assert.equal(receipts, 1);
        assert.ok(JSON.stringify(captured.messages).includes("A, B, 中文"));
        assert.ok(JSON.stringify(captured.messages).includes("tool_fixture"));
        assert.ok(JSON.stringify(captured.messages).includes("自由输入"));
        assert.ok(JSON.stringify(captured.messages).includes("单选测试"));
      }
      assert.ok(events.some((e) => e.type === "assistant"));
      const rendered = historyEvents({
        events: events.map((e, sequence) => ({
          ...e,
          sequence,
          executionId: "fixture",
        })),
      });
      assert.ok(
        JSON.stringify(rendered).includes("Claude 原生协议测试完成"),
        JSON.stringify(events.filter((e) => e.type === "assistant")),
      );
      assert.ok(JSON.stringify(rendered).includes("第二段回答仍须保留"));
      if (mode === "plain") {
        runtime.close();
        let resumedStatus = "";
        const resumed = new ClaudeRuntime(
          {
            event: () => {},
            native: () => {},
            interaction: () => {},
            done: (s) => {
              resumedStatus = s;
            },
            handoff: async () => ({}),
          },
          {
            home,
            baseUrl: `http://127.0.0.1:${address.port}`,
            apiKey: "fixture-not-real",
            model: "",
          },
        );
        try {
          await resumed.start(
            dir,
            {
              permission: "ask",
              runtimeOptions: { model: null, effort: null, thinking: null },
            },
            "继续",
            null,
            nativeId,
          );
          const untilResume = Date.now() + 15000;
          while (!resumedStatus && Date.now() < untilResume)
            await new Promise((r) => setTimeout(r, 30));
          assert.equal(resumedStatus, "completed");
          assert.notEqual(captured.model, "claude-sonnet-4-6");
          assert.notEqual(captured.output_config?.effort, "low");
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
  });
}

useInstalledClaudeSdk();
