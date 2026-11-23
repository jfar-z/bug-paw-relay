import test from "node:test";
import assert from "node:assert/strict";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../src/server/store.js";
import { createApp } from "../src/server/app.js";
import { digest, Vault } from "../src/server/security.js";
import { Service } from "../src/server/service.js";
import { Workbench } from "../src/server/workbench.js";
/** 无凭据协议端点：验证真实 SDK 的流式工具、持久化审批和恢复，不冒充真实模型验收。 */
for (const protocol of ["chat", "responses", "anthropic"])
  test(protocol + " 流式工具调用、重启审批恢复与结果继续", async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-model-"));
    const store = new Store(join(dir, "test.db"));
    const service = new Service(store, new Vault(dir));
    let workbench = new Workbench(service);
    const requests: any[] = [];
    const env = store.put("environments", { name: "fixture" });
    const project = service.save("projects", {
      name: "fixture",
      directories: [],
    });
    const todo = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "fixture",
      projectId: project.id,
      stages: [
        {
          fixedRole: "start",
          id: todo,
          name: "todo",
          type: "human",
          targets: [done],
        },
        { id: done, name: "done", type: "done", targets: [] },
      ],
    });
    let callName = "create_work_item";
    let remainingToolCalls = 1;
    let args = JSON.stringify({
      data: JSON.stringify({
        boardId: board.id,
        title: "SDK 创建的工作项",
        content: "仅测试数据",
        startStageId: done,
        boardVersion: board.version,
      }),
    });
    const mock = Fastify();
    mock.post("/*", async (req, reply) => {
      const body: any = req.body;
      requests.push(body);
      const called = remainingToolCalls-- <= 0;
      const callId = "call-fixture-" + requests.length;
      reply.hijack();
      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
      });
      const data = (value: any, event?: string) =>
        reply.raw.write(
          (event ? "event: " + event + "\n" : "") +
            "data: " +
            JSON.stringify(value) +
            "\n\n",
        );
      if (protocol === "chat") {
        const chunk = (delta: any, finish_reason: any = null) =>
          data({
            id: "chat-test",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason }],
          });
        chunk({ role: "assistant" });
        if (!called) {
          chunk({
            tool_calls: [
              {
                index: 0,
                id: callId,
                type: "function",
                function: { name: callName, arguments: args },
              },
            ],
          });
          chunk({}, "tool_calls");
        } else {
          chunk({ content: "工作项已创建" });
          chunk({}, "stop");
        }
        reply.raw.write("data: [DONE]\n\n");
      } else if (protocol === "responses") {
        let seq = 0;
        const emit = (type: string, rest: any) =>
          data({ type, sequence_number: seq++, ...rest }, type);
        const base = {
          id: "resp-fixture",
          object: "response",
          created_at: 1,
          status: "in_progress",
          model: "fixture",
          output: [],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        };
        emit("response.created", { response: base });
        if (!called) {
          const item = {
            id: "fc-fixture",
            type: "function_call",
            call_id: callId,
            name: callName,
            arguments: args,
            status: "completed",
          };
          emit("response.output_item.added", {
            output_index: 0,
            item: { ...item, arguments: "", status: "in_progress" },
          });
          emit("response.function_call_arguments.delta", {
            item_id: item.id,
            output_index: 0,
            delta: args,
          });
          emit("response.function_call_arguments.done", {
            item_id: item.id,
            output_index: 0,
            arguments: args,
          });
          emit("response.output_item.done", { output_index: 0, item });
          emit("response.completed", {
            response: { ...base, status: "completed", output: [item] },
          });
        } else {
          const item = {
            id: "msg-fixture",
            type: "message",
            role: "assistant",
            status: "completed",
            content: [
              { type: "output_text", text: "工作项已创建", annotations: [] },
            ],
          };
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
            delta: "工作项已创建",
          });
          emit("response.output_text.done", {
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            text: "工作项已创建",
          });
          emit("response.content_part.done", {
            item_id: item.id,
            output_index: 0,
            content_index: 0,
            part: item.content[0],
          });
          emit("response.output_item.done", { output_index: 0, item });
          emit("response.completed", {
            response: { ...base, status: "completed", output: [item] },
          });
        }
      } else {
        const emit = (type: string, rest: any) => data({ type, ...rest }, type);
        emit("message_start", {
          message: {
            id: "msg-fixture",
            type: "message",
            role: "assistant",
            content: [],
            model: "fixture",
            stop_reason: null,
            stop_sequence: null,
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        });
        if (!called) {
          emit("content_block_start", {
            index: 0,
            content_block: {
              type: "tool_use",
              id: callId,
              name: callName,
              input: {},
            },
          });
          emit("content_block_delta", {
            index: 0,
            delta: { type: "input_json_delta", partial_json: args },
          });
        } else {
          emit("content_block_start", {
            index: 0,
            content_block: { type: "text", text: "" },
          });
          emit("content_block_delta", {
            index: 0,
            delta: { type: "text_delta", text: "工作项已创建" },
          });
        }
        emit("content_block_stop", { index: 0 });
        emit("message_delta", {
          delta: {
            stop_reason: called ? "end_turn" : "tool_use",
            stop_sequence: null,
          },
          usage: { output_tokens: 5 },
        });
        emit("message_stop", {});
      }
      reply.raw.end();
    });
    await mock.listen({ host: "127.0.0.1", port: 0 });
    const address = mock.server.address() as any;
    const model = service.save("models", {
      name: "fixture",
      protocol,
      baseUrl: `http://127.0.0.1:${address.port}/v1`,
      model: "fixture",
      apiKey: "fixture-not-real",
      maxTokens: 2048,
    });
    const w = workbench.create({
      title: "test",
      modelId: model.id,
      permission: "ask",
    });
    async function wait(expected: string) {
      const until = Date.now() + 10000;
      while (Date.now() < until) {
        const current = store.get("workbench", w.id);
        if (current.status === expected) return current;
        if (current.status === "failed")
          throw new Error(
            "工作台失败：" + current.error + " / requests=" + requests.length,
          );
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error(
        "未到达状态 " +
          expected +
          " actual=" +
          store.get("workbench", w.id).status,
      );
    }
    try {
      workbench.savePromptSettings({
        version: 0,
        systemPrompt: "本轮规范：回答采用简洁中文。",
      });
      await workbench.start(w.id, {
        message: "请创建测试工作项",
        operationId: randomUUID(),
      });
      const waiting = await wait("approval");
      assert.equal(store.list("items").length, 0);
      assert.ok(waiting.state);
      assert.equal(waiting.approvals[0].name, "create_work_item");
      const creation = JSON.parse(waiting.approvals[0].arguments);
      assert.equal(creation.startStage.id, done);
      assert.equal(creation.effectKey, "workItemCreation.done");
      assert.ok(creation.effect.en);
      assert.equal(creation.data.boardVersion, board.version);
      assert.equal(waiting.transcript.at(-1).blocks[0].status, "approval");
      workbench.savePromptSettings({
        version: 1,
        systemPrompt: "后续规范：回答先列结论。",
      });
      // 分别恢复首版无标记和上轮版本 2 的审批快照。
      const previousContext = protocol === "chat" ? null : 2;
      const legacy = store.put("workbench", { workbenchContextVersion: previousContext }, w.id);
      workbench = new Workbench(service);
      await workbench.approve(w.id, {
        version: legacy.version,
        approve: true,
      });
      await assert.rejects(
        () =>
          workbench.approve(w.id, { version: waiting.version, approve: true }),
        /审批已处理/,
      );
      const result = await wait("idle");
      assert.equal(store.list("items").length, 1);
      assert.equal(store.list("items")[0].stageId, done);
      assert.equal(store.list("items")[0].status, "done");
      assert.match(JSON.stringify(result.transcript), /工作项已创建/);
      assert.equal(requests.length, 2);
      const blocks = result.transcript.at(-1).blocks;
      assert.deepEqual(
        blocks.map((b: any) => b.type),
        ["tool", "text"],
      );
      assert.equal(blocks[0].status, "completed");
      assert.match(blocks[0].output, /SDK 创建的工作项/);
      assert.equal(blocks[1].text, "工作项已创建");
      assert.ok(
        !JSON.stringify(store.list("workbench")).includes("fixture-not-real"),
      );
      assert.ok(requests[0].tools.length > 0);
      const context = (request: any) =>
        JSON.stringify(
          request.instructions ||
            request.system ||
            request.messages?.filter((m: any) =>
              ["system", "developer"].includes(m.role),
            ),
        );
      for (const request of requests) {
        assert.match(context(request), /本轮规范：回答采用简洁中文/);
        assert.doesNotMatch(context(request), /后续规范/);
        assert.match(context(request), /Users can ask an environment agent to publish/);
      }
      assert.equal(JSON.stringify(requests[1].tools).includes("light_app_versions"), previousContext === 2);
      assert.equal(context(requests[1]).includes("永久删除后保留历史标记"), previousContext === 2);
      assert.doesNotMatch(JSON.stringify(requests[1].tools), /light_app_diagnostics/);
      assert.doesNotMatch(context(requests[1]), /新版从空存档开始/);
      await workbench.start(w.id, {
        message: "继续回答",
        operationId: randomUUID(),
      });
      await wait("idle");
      assert.match(context(requests.at(-1)), /后续规范：回答先列结论/);
      assert.doesNotMatch(context(requests.at(-1)), /本轮规范/);
      assert.deepEqual(requests.at(-1).tools, requests[0].tools);
      // 用真实 SDK 在三协议中验证新增工具，含清空后的上下文与写入防重。
      const originalTools = requests[0].tools;
      assert.match(context(requests.at(-1)), /新版从空存档开始/);
      // SDK 的输出事件可能包装为文本块；解开协议外层后校验业务返回值。
      const toolOutput = (output: string) => {
        const value = JSON.parse(output);
        return value.type === "text" ? JSON.parse(value.text) : value;
      };
      // 三种协议均真实调用新读工具，询问权限下不产生写审批。
      const environmentSession = store.put("sessions", {
        environmentId: env.id,
        title: "工具验证",
        status: "completed",
      });
      const item = store.list("items")[0];
      const source = { sessionId: environmentSession.id, itemId: item.id, environmentId: env.id };
      const app = store.put("lightApps", { ...source, title: "演示", listed: false });
      const first = store.put("lightVersions", { ...source, appId: app.id, number: 1 });
      const second = store.put("lightVersions", { ...source, appId: app.id, number: 2 });
      const error = { kind: "script", message: "render failed", file: "app.js", line: 7, column: 2, count: 3 };
      store.put("lightDiagnostics", { versionId: first.id, ...error });
      store.put("lightFeedback", { versionId: first.id, text: "第一版反馈", kind: "issue" });
      store.put("lightApps", { ...source, title: "演示", listed: false, deletion: "deleted" });
      for (const permission of ["ask", "full"]) {
        workbench.configure(w.id, { modelId: model.id, permission });
        for (const name of ["light_app_versions", "light_app_feedback", "light_app_diagnostics", "board_items"]) {
          callName = name;
          const scope = permission === "ask"
            ? { sourceKind: "session", sourceId: environmentSession.id }
            : { sourceKind: "item", sourceId: item.id };
          args = JSON.stringify(name === "board_items" ? { boardId: board.id, itemId: null }
            : name === "light_app_versions" ? scope : { ...scope, versionId: first.id });
          remainingToolCalls = 1;
          await workbench.start(w.id, { message: "读取平台记录", operationId: randomUUID() });
          const queried = await wait("idle");
          const block = queried.transcript.at(-1).blocks[0];
          assert.equal(block.status, "completed");
          const output = toolOutput(block.output);
          if (name === "light_app_versions") {
            assert.equal(output.apps.length, 1);
            assert.equal(output.apps[0].listed, false);
            assert.deepEqual(output.apps[0].versions.map((v: any) => v.feedbackCount), [1, 0]);
          } else if (name === "light_app_diagnostics") {
            assert.deepEqual(output, { appId: app.id, versionId: first.id, number: 1, runtimeErrorCount: 3, runtimeErrors: [error] });
          } else if (name === "light_app_feedback") {
            assert.equal(output.feedback[0].text, "第一版反馈");
          } else {
            assert.equal(output.items[0].stageId, done);
            assert.equal(output.items[0].itemId, item.id);
          }
        }
      }
      workbench.configure(w.id, { modelId: model.id, permission: "ask" });
      // 已存在但不属于当前版本的来源不能借版本标识读取反馈。
      const other = store.put("sessions", { environmentId: env.id, title: "其他来源" });
      callName = "light_app_feedback";
      args = JSON.stringify({ sourceKind: "session", sourceId: other.id, versionId: first.id });
      remainingToolCalls = 1;
      await workbench.start(w.id, { message: "按来源查询反馈", operationId: randomUUID() });
      const scoped = await wait("idle");
      assert.equal(scoped.transcript.at(-1).blocks[0].status, "failed");
      assert.match(JSON.stringify(requests.at(-1)), /LIGHT_SCOPE/);
      callName = "light_app_diagnostics";
      const queryDiagnostics = async (sourceId: string, versionId: string) => {
        args = JSON.stringify({ sourceKind: "session", sourceId, versionId });
        remainingToolCalls = 1;
        await workbench.start(w.id, { message: "查询运行报错", operationId: randomUUID() });
        return (await wait("idle")).transcript.at(-1).blocks[0];
      };
      const empty = await queryDiagnostics(environmentSession.id, second.id);
      assert.deepEqual(toolOutput(empty.output), {
        appId: app.id, versionId: second.id, number: 2, runtimeErrorCount: 0, runtimeErrors: [],
      });
      assert.equal((await queryDiagnostics(other.id, first.id)).status, "failed");
      assert.match(JSON.stringify(requests.at(-1)), /LIGHT_SCOPE/);
      store.put("lightApps", { deletion: "deleted" }, app.id);
      assert.equal((await queryDiagnostics(environmentSession.id, first.id)).status, "failed");
      assert.match(JSON.stringify(requests.at(-1)), /LIGHT_DELETED/);
      const environmentExecution = randomUUID();
      store.db
        .prepare("INSERT INTO executions VALUES(?,?,?,?,?,?,?)")
        .run(
          environmentExecution,
          null,
          environmentSession.id,
          env.id,
          "completed",
          "{}",
          new Date().toISOString(),
        );
      service.peers.set(env.id, {
        call: async (method: string) =>
          method === "session.history"
            ? {
                events: [
                  {
                    type: "user",
                    sequence: 1,
                    executionId: environmentExecution,
                    data: { text: "旧问题" },
                  },
                ],
                gap: false,
              }
            : {
                executionId: environmentExecution,
                status: "completed",
                reply: "完成",
              },
      } as any);
      for (const [name, input] of [
        [
          "session_wait",
          { executionIds: [environmentExecution], timeoutSeconds: 60 },
        ],
        [
          "session_history",
          {
            sessionId: environmentSession.id,
            before: null,
            limit: 20,
            includeTools: false,
          },
        ],
        ["session_result", { executionId: environmentExecution }],
      ] as const) {
        callName = name;
        args = JSON.stringify(input);
        remainingToolCalls = 1;
        await workbench.start(w.id, {
          message: "查询环境会话",
          operationId: randomUUID(),
        });
        const queried = await wait("idle");
        const block = queried.transcript
          .at(-1)
          .blocks.find((b: any) => b.type === "tool");
        assert.equal(block.status, "completed");
        const output = toolOutput(block.output);
        if (name === "session_history")
          assert.equal(output.messages[0].content, "旧问题");
        else if (name === "session_wait")
          assert.equal(output.results[0].reply, "完成");
        else assert.equal(output.reply, "完成");
      }
      // 复现只有系统级智能体时返回空列表的问题，并验证混合清单与写入边界。
      const systemAgent = service.save("agents", {
        name: "系统智能体",
        instructions: "测试职责",
      });
      for (const mixed of [false, true]) {
        if (mixed) {
          const environmentAgent = service.save("agents", {
            name: "环境智能体",
            environmentId: env.id,
            instructions: "环境职责",
          });
          service.saveAgentOrder([environmentAgent.id, systemAgent.id]);
        }
        callName = "platform_read";
        args = JSON.stringify({ kind: "agents" });
        remainingToolCalls = 1;
        await workbench.start(w.id, {
          message: "查询全部智能体",
          operationId: randomUUID(),
        });
        const queried = await wait("idle");
        const block = queried.transcript
          .at(-1)
          .blocks.find((b: any) => b.type === "tool");
        assert.equal(block.status, "completed");
        assert.deepEqual(toolOutput(block.output), service.list("agents"));
        assert.equal(toolOutput(block.output).length, mixed ? 2 : 1);
      }
      workbench.configure(w.id, { modelId: model.id, permission: "full" });
      for (const action of ["update", "delete"]) {
        callName = "environment_agent_write";
        args = JSON.stringify({
          data: JSON.stringify({
            action,
            id: systemAgent.id,
            version: systemAgent.version,
            agent: {
              name: "不应更新",
              environmentId: env.id,
              instructions: "测试",
            },
          }),
        });
        remainingToolCalls = 1;
        await workbench.start(w.id, {
          message: "尝试修改系统智能体",
          operationId: randomUUID(),
        });
        const rejected = await wait("idle");
        assert.equal(rejected.transcript.at(-1).blocks[0].status, "failed");
        assert.deepEqual(store.get("agents", systemAgent.id), systemAgent);
      }
      // 三协议实际验证结构化看板工具、字段反馈、审批恢复和旧参数兼容。
      const directory = {
        environmentId: env.id,
        rootId: "fixture-root",
        relativePath: "relay",
      };
      const boardProject = service.save("projects", {
        name: "工具项目",
        directories: [directory],
      });
      const stageIds = Array.from({ length: 8 }, () => randomUUID());
      const boardInput = {
        name: "七阶段流程",
        projectId: boardProject.id,
        stages: [
          "human",
          "agent",
          "human",
          "agent",
          "agent",
          "agent",
          "human",
          "done",
        ].map((type, index) => ({
          id: stageIds[index],
          ...(index === 0 ? { fixedRole: "start" as const } : {}),
          name: [
            "未开始",
            "产品经理",
            "人工确认需求",
            "后端",
            "前端",
            "运维",
            "人工验收",
            "结束",
          ][index],
          type,
          targets: index === 7 ? [] : [stageIds[index + 1]],
          ...(type === "agent"
            ? { ...directory, agentId: systemAgent.id }
            : {}),
        })),
      };
      const boardCount = store.list("boards").length;
      const invalid = [
        [
          {
            action: "create",
            board: {
              ...boardInput,
              stages: [{ name: "错误", type: "manual" }],
            },
          },
          /board\.stages\[0\]\.targets/,
        ],
        [
          { action: "create", board: { ...boardInput, stages: [] } },
          /board\.stages/,
        ],
        [
          {
            action: "create",
            board: {
              ...boardInput,
              stages: boardInput.stages.map((stage, index) =>
                index === 0 ? { ...stage, targets: [stage.id] } : stage,
              ),
            },
          },
          /board\.stages\[0\]\.targets/,
        ],
        [
          {
            action: "create",
            board: {
              ...boardInput,
              stages: boardInput.stages.map((stage, index) =>
                index === 1 ? { ...stage, relativePath: "wrong" } : stage,
              ),
            },
          },
          /DIRECTORY_MISMATCH/,
        ],
        [{ action: "typo", board: boardInput }, /action/],
        [{ data: "invalid secret-fixture-json" }, /VALIDATION_ERROR/],
      ] as const;
      for (const [input, expected] of invalid) {
        callName = "board_write";
        args = JSON.stringify(input);
        remainingToolCalls = 1;
        await workbench.start(w.id, {
          message: "校验看板",
          operationId: randomUUID(),
        });
        const failed = await wait("idle");
        const block = failed.transcript.at(-1).blocks[0];
        assert.equal(block.status, "failed");
        assert.match(block.output, expected);
        assert.doesNotMatch(block.output, /secret-fixture/);
        assert.match(JSON.stringify(requests.at(-1)), expected);
        assert.equal(store.list("boards").length, boardCount);
      }
      workbench.configure(w.id, { modelId: model.id, permission: "ask" });
      callName = "board_write";
      args = JSON.stringify({ action: "create", board: boardInput });
      remainingToolCalls = 2;
      await workbench.start(w.id, {
        message: "创建七阶段看板",
        operationId: randomUUID(),
      });
      for (let index = 0; index < 2; index++) {
        const approval = await wait("approval");
        assert.equal(store.list("boards").length, boardCount + index);
        workbench = new Workbench(service);
        await workbench.approve(w.id, {
          version: approval.version,
          approve: true,
        });
      }
      await wait("idle");
      assert.equal(store.list("boards").length, boardCount + 1);
      const createdBoard = store
        .list("boards")
        .find((entry) => entry.name === boardInput.name)!;
      assert.equal(createdBoard.stages.length, 8);
      assert.equal(createdBoard.stages[7].name, "结束");
      const toolSchemas = JSON.stringify(requests.at(-1).tools);
      assert.match(toolSchemas, /targets/);
      assert.match(toolSchemas, /human/);
      workbench.configure(w.id, { modelId: model.id, permission: "full" });
      // 旧 data 包装继续支持更新与删除。
      for (const input of [
        {
          action: "update",
          id: createdBoard.id,
          version: createdBoard.version,
          board: { ...boardInput, name: "更新流程" },
        },
        { action: "delete", id: createdBoard.id },
      ]) {
        args = JSON.stringify(input);
        remainingToolCalls = 1;
        await workbench.start(w.id, {
          message: "管理看板",
          operationId: randomUUID(),
        });
        const finished = await wait("idle");
        assert.equal(finished.transcript.at(-1).blocks[0].status, "completed");
      }
      assert.equal(store.list("boards").length, boardCount);
      for (const mode of [
        "read",
        "clear",
        "full",
        "denied",
        "conflict",
        "forbidden",
      ]) {
        const permission = ["full", "forbidden"].includes(mode)
          ? "full"
          : "ask";
        workbench.configure(w.id, { modelId: model.id, permission });
        const before = workbench.promptSettings();
        callName =
          mode === "read" ? "workbench_prompt_read" : "workbench_prompt_write";
        args =
          mode === "read"
            ? "{}"
            : JSON.stringify({
                data: JSON.stringify({
                  systemPrompt: mode === "full" ? "经工具保存的新规范" : "",
                  version: before.version,
                  ...(mode === "forbidden"
                    ? { product: "越权修改产品说明" }
                    : {}),
                }),
              });
        remainingToolCalls = mode === "full" ? 2 : 1;
        const requestIndex: number = requests.length;
        await workbench.start(w.id, {
          message: "明确测试提示词操作：" + mode,
          operationId: randomUUID(),
        });
        if (["clear", "denied", "conflict"].includes(mode)) {
          const pending = await wait("approval");
          assert.equal(pending.approvals[0].name, "workbench_prompt_write");
          assert.deepEqual(workbench.promptSettings(), before);
          if (mode === "conflict")
            workbench.savePromptSettings({
              version: before.version,
              systemPrompt: "设置页并发保存",
            });
          workbench = new Workbench(service);
          await workbench.approve(w.id, {
            version: pending.version,
            approve: mode !== "denied",
          });
          await assert.rejects(
            workbench.approve(w.id, {
              version: pending.version,
              approve: true,
            }),
            /审批已处理/,
          );
        }
        const finished = await wait("idle");
        const settings = workbench.promptSettings();
        const blocks = finished.transcript.at(-1).blocks;
        const toolBlocks = blocks.filter((b: any) => b.type === "tool");
        assert.ok(toolBlocks.length);
        assert.equal(finished.systemPromptSnapshot, before.systemPrompt);
        if (mode === "read") {
          assert.deepEqual(toolOutput(toolBlocks[0].output), before);
          assert.deepEqual(settings, before);
          assert.equal(toolBlocks[0].status, "completed");
        } else if (mode === "clear" || mode === "full") {
          assert.equal(
            settings.systemPrompt,
            mode === "clear" ? "" : "经工具保存的新规范",
          );
          assert.equal(settings.version, before.version + 1);
          for (const block of toolBlocks) {
            assert.equal(block.status, "completed");
            assert.equal(toolOutput(block.output).effectiveFrom, "next_turn");
          }
          if (mode === "full") {
            assert.equal(toolBlocks.length, 2);
            assert.equal(finished.systemPromptSnapshot, "");
            // 显式清空不能在新一轮悄悄回退默认规范，产品事实与工具注册仍存在。
            assert.doesNotMatch(
              context(requests[requestIndex]),
              /涉及实时状态先读取工具|后续规范/,
            );
          }
        } else if (mode === "denied") {
          assert.deepEqual(settings, before);
          assert.equal(toolBlocks[0].status, "denied");
        } else {
          assert.equal(toolBlocks[0].status, "failed");
          assert.equal(
            settings.systemPrompt,
            mode === "conflict" ? "设置页并发保存" : before.systemPrompt,
          );
          assert.equal(
            settings.version,
            before.version + (mode === "conflict" ? 1 : 0),
          );
        }
        assert.match(context(requests[requestIndex]), /BugPaw Relay/);
        assert.deepEqual(requests[requestIndex].tools, originalTools);
      }
      assert.ok(
        !JSON.stringify(workbench.public(result)).includes("fixture-not-real"),
      );
    } finally {
      await mock.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

/** 生命周期覆盖归档只读、恢复、版本冲突和关联压缩记录清理。 */
test("工作台归档恢复与删除保持运行及版本边界", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-workbench-manage-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  const workbench = new Workbench(service);
  try {
    const model = store.put("models", { name: "fixture" });
    const session = workbench.create({
      title: "保留历史",
      modelId: model.id,
      permission: "ask",
    });
    const archive = store.put("archives", {
      workbenchId: session.id,
      history: ["压缩前内容"],
    });
    const other = store.put("archives", {
      workbenchId: randomUUID(),
      history: [],
    });
    store.db
      .prepare("INSERT INTO operations VALUES(?,?,?,?,?)")
      .run("fixture-operation", session.id, "hash", "completed", "{}");
    const archived = workbench.manage(session.id, {
      action: "archive",
      version: session.version,
    });
    assert.ok("version" in archived);
    assert.ok(archived.archivedAt);
    await assert.rejects(
      workbench.start(session.id, {
        message: "归档后禁止发送",
        operationId: randomUUID(),
      }),
      /先恢复/,
    );
    await assert.rejects(workbench.compress(session.id), /先恢复/);
    assert.throws(
      () =>
        workbench.manage(session.id, {
          action: "delete",
          version: session.version,
        }),
      /已变更/,
    );
    const restored = workbench.manage(session.id, {
      action: "restore",
      version: archived.version,
    });
    assert.ok("version" in restored);
    assert.equal(restored.archivedAt, null);
    for (const status of ["running", "approval", "resuming"]) {
      const busy = store.put("workbench", { status }, session.id);
      await assert.rejects(
        workbench.start(session.id, {
          message: "不能覆盖正在恢复的会话",
          operationId: randomUUID(),
        }),
        /先完成/,
      );
      assert.throws(
        () =>
          workbench.manage(session.id, {
            action: "delete",
            version: busy.version,
          }),
        /先停止/,
      );
      assert.throws(
        () =>
          workbench.manage(session.id, {
            action: "archive",
            version: busy.version,
          }),
        /先停止/,
      );
    }
    const idle = store.put("workbench", { status: "idle" }, session.id);
    workbench.manage(session.id, { action: "delete", version: idle.version });
    assert.throws(() => store.get("workbench", session.id), /不存在/);
    assert.throws(() => store.get("archives", archive.id), /不存在/);
    assert.ok(store.get("archives", other.id));
    assert.equal(
      store.db
        .prepare("SELECT count(*) AS n FROM operations WHERE scope=?")
        .get(session.id)?.n,
      0,
    );
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 假端点驱动真实 SDK，验证多段文本、失败工具及拒绝审批的有序持久化。 */
for (const mode of ["success", "failure", "denied", "cancel"])
  test("工作台活动顺序与状态：" + mode, async () => {
    const dir = mkdtempSync(join(tmpdir(), "relay-activity-"));
    const store = new Store(join(dir, "test.db"));
    const service = new Service(store, new Vault(dir));
    const workbench = new Workbench(service);
    const project = service.save("projects", {
      name: "fixture",
      directories: [],
    });
    const todo = randomUUID(),
      done = randomUUID();
    const board = service.save("boards", {
      name: "fixture",
      projectId: project.id,
      stages: [
        {
          fixedRole: "start",
          id: todo,
          name: "待处理",
          type: "human",
          targets: [done],
        },
        { id: done, name: "完成", type: "done", targets: [] },
      ],
    });
    const mock = Fastify();
    let calls = 0;
    mock.post("/*", async (_req, reply) => {
      const first = calls++ === 0;
      reply.hijack();
      reply.raw.writeHead(200, { "Content-Type": "text/event-stream" });
      const chunk = (delta: any, finish_reason: any = null) =>
        reply.raw.write(
          "data: " +
            JSON.stringify({
              id: "chat-fixture",
              object: "chat.completion.chunk",
              created: 1,
              model: "fixture",
              choices: [{ index: 0, delta, finish_reason }],
            }) +
            "\n\n",
        );
      chunk({ role: "assistant" });
      if (first) {
        chunk({ content: "先读取平台。" });
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call-ordered",
              type: "function",
              function: {
                name: mode === "success" ? "platform_read" : "create_work_item",
                arguments:
                  mode === "success"
                    ? JSON.stringify({ kind: "projects" })
                    : JSON.stringify({
                        data: JSON.stringify({
                          boardId: mode === "failure" ? randomUUID() : board.id,
                          title: "fixture",
                        }),
                      }),
              },
            },
          ],
        });
        chunk({}, "tool_calls");
      } else {
        chunk({ content: "工具处理之后的回答。" });
        chunk({}, "stop");
      }
      reply.raw.end("data: [DONE]\n\n");
    });
    await mock.listen({ host: "127.0.0.1", port: 0 });
    try {
      const model = service.save("models", {
        name: "fixture",
        protocol: "chat",
        baseUrl: `http://127.0.0.1:${(mock.server.address() as any).port}/v1`,
        model: "fixture",
        apiKey: "fixture-not-real",
        maxTokens: 2048,
      });
      const w = workbench.create({
        title: "活动测试",
        modelId: model.id,
        permission: ["denied", "cancel"].includes(mode) ? "ask" : "full",
      });
      const wait = async (status: string) => {
        for (let i = 0; i < 500; i++) {
          const current = store.get("workbench", w.id);
          if (current.status === status) return current;
          if (current.status === "failed") assert.fail(current.error);
          await new Promise((resolve) => setTimeout(resolve, 20));
        }
        throw new Error("运行未完成");
      };
      await workbench.start(w.id, {
        message: "测试工具",
        operationId: randomUUID(),
      });
      if (["denied", "cancel"].includes(mode)) {
        const pending = await wait("approval");
        if (mode === "cancel") workbench.cancel(w.id);
        else
          await workbench.approve(w.id, {
            version: pending.version,
            approve: false,
          });
      }
      const result = await wait(mode === "cancel" ? "cancelled" : "idle");
      const blocks = result.transcript.at(-1).blocks;
      assert.deepEqual(
        blocks.map((b: any) => b.type),
        mode === "cancel" ? ["text", "tool"] : ["text", "tool", "text"],
      );
      assert.equal(blocks[0].text, "先读取平台。");
      assert.equal(
        blocks[1].status,
        {
          success: "completed",
          failure: "failed",
          denied: "denied",
          cancel: "cancelled",
        }[mode],
      );
      if (mode !== "cancel")
        assert.equal(blocks[2].text, "工具处理之后的回答。");
      assert.equal(
        result.transcript.filter((m: any) => m.role === "assistant").length,
        1,
      );
    } finally {
      await mock.close();
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

/** 压缩期间禁止并发删除与续发，失败或成功后均释放独占状态。 */
test("上下文压缩与会话管理互斥", async () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-compress-lock-"));
  const store = new Store(join(dir, "test.db"));
  const service = new Service(store, new Vault(dir));
  const workbench = new Workbench(service);
  const mock = Fastify();
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  mock.post("/*", async () => {
    entered();
    await pending;
    return {
      id: "summary-fixture",
      object: "chat.completion",
      created: 1,
      model: "fixture",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "历史摘要" },
          finish_reason: "stop",
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    };
  });
  await mock.listen({ host: "127.0.0.1", port: 0 });
  try {
    const model = service.save("models", {
      name: "fixture",
      protocol: "chat",
      baseUrl: `http://127.0.0.1:${(mock.server.address() as any).port}/v1`,
      model: "fixture",
      apiKey: "fixture-not-real",
      maxTokens: 2048,
    });
    const session = workbench.create({
      title: "压缩互斥",
      modelId: model.id,
      permission: "ask",
    });
    const job = workbench.compress(session.id);
    await started;
    assert.throws(
      () =>
        workbench.manage(session.id, {
          action: "delete",
          version: session.version,
        }),
      /先停止/,
    );
    await assert.rejects(
      workbench.start(session.id, {
        message: "压缩时不能发送",
        operationId: randomUUID(),
      }),
      /正在压缩/,
    );
    assert.throws(
      () =>
        workbench.configure(session.id, {
          modelId: model.id,
          permission: "full",
        }),
      /正在压缩/,
    );
    await assert.rejects(workbench.compress(session.id), /正在压缩/);
    release();
    const compressed = await job;
    assert.match(JSON.stringify(compressed.history), /历史摘要/);
    assert.equal(store.list("archives").length, 1);
    workbench.manage(session.id, {
      action: "delete",
      version: compressed.version,
    });
    assert.equal(store.list("archives").length, 0);
  } finally {
    release();
    await mock.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 整批操作遇到忙碌或版本冲突时，前面的会话修改也必须回滚。 */
test("工作台批量管理原子性与版本保护", () => {
  const dir = mkdtempSync(join(tmpdir(), "relay-workbench-batch-"));
  const store = new Store(join(dir, "test.db"));
  const workbench = new Workbench(new Service(store, new Vault(dir)));
  try {
    const model = store.put("models", { name: "fixture" });
    const first = workbench.create({
      title: "第一条",
      modelId: model.id,
      permission: "ask",
    });
    const second = workbench.create({
      title: "第二条",
      modelId: model.id,
      permission: "ask",
    });
    const busy = store.put("workbench", { status: "running" }, second.id);
    assert.throws(() =>
      workbench.manageBatch({
        action: "delete",
        sessions: [first, busy].map(({ id, version }) => ({ id, version })),
      }),
    );
    assert.ok(store.get("workbench", first.id));
    const idle = store.put("workbench", { status: "idle" }, second.id);
    assert.throws(() =>
      workbench.manageBatch({
        action: "archive",
        sessions: [first, second].map(({ id, version }) => ({ id, version })),
      }),
    );
    assert.ok(!store.get("workbench", first.id).archivedAt);
    workbench.manageBatch({
      action: "archive",
      sessions: [first, idle].map(({ id, version }) => ({ id, version })),
    });
    assert.ok(store.get("workbench", first.id).archivedAt);
    assert.ok(store.get("workbench", second.id).archivedAt);
    workbench.manageBatch({
      action: "delete",
      sessions: store
        .list("workbench")
        .map(({ id, version }) => ({ id, version })),
    });
    assert.equal(store.list("workbench").length, 0);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

/** 设置接口拒绝越界字段和过期写入，配置在服务重启后仍存在。 */
test("工作台提示词设置鉴权、白名单、版本与持久化", async () => {
  const { createApp } = await import("../src/server/app.js");
  const { digest } = await import("../src/server/security.js");
  const dir = mkdtempSync(join(tmpdir(), "relay-prompt-settings-"));
  const options = {
    dataDir: dir,
    publicUrl: "http://localhost",
    secureCookie: false,
  };
  let instance = await createApp(options);
  const headers = {
    origin: "http://localhost",
    cookie: "relay_session=prompt-fixture",
  };
  const url = "/api/settings/workbench-prompt";
  try {
    assert.equal((await instance.app.inject({ url })).statusCode, 401);
    assert.equal(
      (
        await instance.app.inject({
          url,
          method: "POST",
          headers: { origin: "http://localhost" },
          payload: { version: 0, systemPrompt: "未授权" },
        })
      ).statusCode,
      401,
    );
    instance.store.db
      .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
      .run(digest("prompt-fixture"), "owner", Date.now() + 60000);
    const initial = (await instance.app.inject({ url, headers })).json();
    assert.equal(initial.version, 0);
    assert.equal(initial.systemPrompt, "");
    assert.equal(initial.defaultSystemPrompt, "");
    for (const extra of [
      { product: "篡改产品" },
      { tools: [] },
      { toolSchema: {} },
      { defaultSystemPrompt: "篡改默认" },
    ]) {
      assert.equal(
        (
          await instance.app.inject({
            url,
            method: "POST",
            headers,
            payload: { version: 0, systemPrompt: "规范", ...extra },
          })
        ).statusCode,
        400,
      );
    }
    for (const systemPrompt of ["x".repeat(40001), null])
      assert.equal(
        (
          await instance.app.inject({
            url,
            method: "POST",
            headers,
            payload: { version: 0, systemPrompt },
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await instance.app.inject({
          url,
          method: "POST",
          headers: { ...headers, origin: "https://untrusted.invalid" },
          payload: { version: 0, systemPrompt: "规范" },
        })
      ).statusCode,
      403,
    );
    const saved = await instance.app.inject({
      url,
      method: "POST",
      headers,
      payload: { version: 0, systemPrompt: "自定义规范" },
    });
    assert.equal(saved.statusCode, 200);
    assert.equal(saved.json().version, 1);
    assert.equal(
      (
        await instance.app.inject({
          url,
          method: "POST",
          headers,
          payload: { version: 0, systemPrompt: "过期覆盖" },
        })
      ).statusCode,
      409,
    );
    await instance.app.close();
    instance = await createApp(options);
    const restored = (await instance.app.inject({ url, headers })).json();
    assert.equal(restored.systemPrompt, "自定义规范");
    assert.equal(restored.defaultSystemPrompt, initial.defaultSystemPrompt);
    const reset = await instance.app.inject({
      url,
      method: "POST",
      headers,
      payload: {
        version: restored.version,
        systemPrompt: restored.defaultSystemPrompt,
      },
    });
    assert.equal(reset.json().systemPrompt, initial.systemPrompt);
    for (const systemPrompt of ["", "   "]) {
      const value = instance.workbench.promptSettings();
      const empty = await instance.app.inject({
        url,
        method: "POST",
        headers,
        payload: { version: value.version, systemPrompt },
      });
      assert.equal(empty.statusCode, 200);
      assert.equal(empty.json().systemPrompt, "");
      await instance.app.close();
      instance = await createApp(options);
      assert.equal(instance.workbench.promptSettings().systemPrompt, "");
    }
  } finally {
    await instance.app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("工作台列表仅返回摘要，归档和详情读取沿用同一会话", async (t) => {
  const dir = mkdtempSync(join(tmpdir(), "relay-workbench-list-"));
  const { app, store } = await createApp({
    dataDir: dir,
    publicUrl: "http://localhost",
  });
  t.after(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const cookie = randomUUID();
  store.db
    .prepare("INSERT INTO auth_sessions VALUES(?,?,?)")
    .run(digest(cookie), "owner", Date.now() + 60000);
  const headers = {
    origin: "http://localhost",
    cookie: "relay_session=" + cookie,
  };
  const transcript = [{ role: "user", text: "长对话".repeat(100_000) }];
  const legacy = store.put("workbench", {
    title: "旧会话",
    status: "idle",
    transcript,
  });
  const latest = store.put("workbench", {
    title: "最近活动",
    status: "idle",
    lastUserMessageAt: "2099-01-01T00:00:00Z",
  });
  const list = async (query = "") => {
    const res = await app.inject({ url: "/api/workbench" + query, headers });
    assert.equal(res.statusCode, 200);
    assert.ok(Buffer.byteLength(res.body) < 2048);
    return res.json();
  };
  const rows = await list();
  assert.deepEqual(
    rows.map((row: { id: string }) => row.id),
    [latest.id, legacy.id],
  );
  assert.deepEqual(rows[1], {
    id: legacy.id,
    title: legacy.title,
    status: legacy.status,
    version: legacy.version,
    createdAt: legacy.createdAt,
    archivedAt: null,
    lastUserMessageAt: null,
  });
  assert.deepEqual(await list(), rows);
  const detail = await app.inject({
    url: "/api/workbench/" + legacy.id,
    headers,
  });
  assert.deepEqual(detail.json().transcript, transcript);
  const managed = await app.inject({
    method: "POST",
    url: "/api/workbench/manage",
    headers,
    payload: {
      action: "archive",
      sessions: [{ id: rows[1].id, version: rows[1].version }],
    },
  });
  assert.equal(managed.statusCode, 200);
  assert.deepEqual(await list(), [rows[0]]);
  const archived = await list("?archived=true");
  assert.equal(archived.length, 1);
  assert.equal(archived[0].id, legacy.id);
  assert.ok(archived[0].archivedAt);
  assert.equal(archived[0].version, legacy.version + 1);
});
