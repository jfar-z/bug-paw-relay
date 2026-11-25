import { matchesWorkflowInput } from "./stage-handoff.js";
import { isCodexAsyncQuestion, type QuestionRecord } from "./user-questions.js";

/** 只有完整的原生回传可抵消气泡；本地 user 事件始终沿用普通发送回显规则。 */
function receiptText(record: QuestionRecord) {
  if (
    record.form.provider !== "codex" ||
    record.status !== "answered" ||
    !record.answer
  )
    return;
  const answers = [];
  for (const question of record.form.questions) {
    const answer = record.answer.answers.find(
      (a) => a.questionId === question.id,
    );
    if (!answer) return;
    const values = answer.optionIds.map(
      (id) => question.options.find((o) => o.id === id)?.label,
    );
    if (values.includes(undefined)) return;
    if (answer.text !== undefined) values.push(answer.text);
    answers.push({ question: question.question, answers: values });
  }
  return JSON.stringify({ requestId: record.nativeId, answers });
}

/** 环境事件按执行与序号去重；晚到历史不得覆盖已经收到的增量。 */
export function mergeSessionEvents(left: any[] = [], right: any[] = []) {
  const events = new Map<string, any>();
  for (const event of [...left, ...right])
    events.set(`${event.executionId || "legacy"}:${event.sequence}`, event);
  const runs = new Map<string, number>();
  for (const event of events.values())
    if (!runs.has(event.executionId)) runs.set(event.executionId, runs.size);
  return [...events.values()].sort(
    (a, b) =>
      runs.get(a.executionId)! - runs.get(b.executionId)! ||
      a.sequence - b.sequence,
  );
}

/** 旧连接器回显需求原文，原生历史包含阶段上下文；仅识别完整包装，禁止子串去重。 */
function matchesUserInput(nativeText: string, text: string): boolean {
  if (nativeText === text) return true;
  if (matchesWorkflowInput(nativeText, text)) return true;
  const marker = `\n${text}\n允许目标：`;
  const offset = nativeText.lastIndexOf(marker);
  if (offset < 0 || !nativeText.slice(0, offset).includes("\n工作项："))
    return false;
  const suffix = nativeText.slice(offset + marker.length);
  const match =
    /^(.*)\n交接历史：(.*)\n(?:完成后调用 (?:relay_handoff 工具提交记录并选择合法目标。|mcp__relay__handoff 工具。)|当前阶段没有合法交接出口，不提供交接工具。 This stage has no allowed targets; no handoff tool is available\.)$/.exec(
      suffix,
    );
  if (!match) return false;
  try {
    return (
      Array.isArray(JSON.parse(match[1])) && Array.isArray(JSON.parse(match[2]))
    );
  } catch {
    // 损坏或相似的普通文本不能作为已持久化输入的证据。
    return false;
  }
}

type BoardInput = { executionId: string; text: string; nativeText?: string; boardIds?: string[] };

/** 原生完整输入与对应执行共同确认回显；只对旧记录中该次授权过的 ID 尝试还原。 */
function boardEcho(native: string, input: BoardInput) {
  if (input.nativeText) return matchesUserInput(native, input.nativeText);
  const ids = input.boardIds;
  if (!ids?.length) return false;
  const restored = native.replace(/ \(boardId=([^()\s]+)\)/g, (suffix, id) =>
    ids.includes(id) ? "" : suffix);
  return restored !== native && matchesUserInput(restored, input.text);
}

/** 按 Codex 原生输入项或 Claude 首条回复定位同轮输入，原始会话记录保持完整。 */
export function displayBoardHistory(history: any, bindings: Map<string, BoardInput>) {
  if (!bindings.size) return history;
  const restore = (message: any, binding?: BoardInput) => {
    if (!binding) return message;
    if (!message) return message;
    const { content } = message;
    if (typeof content === "string") {
      return boardEcho(content, binding) ? { ...message, content: binding.text, relayExecutionId: binding.executionId } : message;
    }
    if (!Array.isArray(content)) return message;
    const block = content.find(entry => ["text", "input_text"].includes(entry?.type) &&
      typeof entry.text === "string" && boardEcho(entry.text, binding));
    return block ? {
      ...message,
      content: content.map(entry => entry === block ? { ...entry, text: binding.text } : entry),
      relayExecutionId: binding.executionId,
    } : message;
  };
  if (history?.thread?.turns) {
    const turns = history.thread.turns.map((turn: any) => ({
      ...turn,
      items: turn.items?.map((item: any) => item.type === "userMessage"
        ? restore(item, bindings.get("item:" + item.id) ?? bindings.get("turn:" + turn.id))
        : item),
    }));
    return { ...history, thread: { ...history.thread, turns } };
  }
  if (!Array.isArray(history)) return history;
  let inputIndex = -1;
  const messages = [...history];
  for (const [i, message] of history.entries()) {
    if (message.type === "user") inputIndex = i;
    if (inputIndex < 0 || !message.uuid) continue;
    const binding = bindings.get("claude:" + message.uuid);
    if (!binding) continue;
    const user = messages[inputIndex];
    messages[inputIndex] = { ...user, message: restore(user.message, binding) };
    inputIndex = -1;
  }
  return messages;
}

/** 只依据同次执行、同轮的模型输出或终态确认重连结果，普通通知和工具输出不代表连接恢复。 */
function nativeRetryState(event: any, following: any[], turns: any[]) {
  const turnId = event.data?.turnId;
  for (const next of following) {
    if (!event.executionId || next.executionId !== event.executionId) continue;
    const nextTurn = next.data?.turnId || next.data?.turn?.id;
    if (turnId && nextTurn && turnId !== nextTurn) continue;
    if (next.type === "user" || next.type === "turn/started") break;
    if (next.type === "error" && next.data?.willRetry !== true) return "ended";
    if (next.type === "turn/completed")
      return next.data?.turn?.status === "completed" ? "recovered" : "ended";
    if (
      [
        "item/agentMessage/delta",
        "item/reasoning/textDelta",
        "item/reasoning/summaryTextDelta",
      ].includes(next.type) ||
      (["item/started", "item/completed"].includes(next.type) &&
        ["agentMessage", "reasoning"].includes(next.data?.item?.type))
    )
      return "recovered";
  }
  // 刷新后缓冲可能被截断，只能用相同原生轮次的终态补足证据。
  const turn = turnId && turns.find((value: any) => value.id === turnId);
  if (turn?.status === "completed") return "recovered";
  if (["failed", "interrupted"].includes(turn?.status)) return "ended";
  return "retrying";
}

/** 合并原生历史与流式缓冲，生成稳定消息 ID，禁止修改 React 中的原始快照。 */
export function historyEvents(history: any, includeQuestions = false): any[] {
  if (!history) return [];
  const rows = new Map<string, any>();
  const nativeUsers = new Map<string, string[]>();
  // 持久化审批可能已离开补传缓存，也可能与本次 SSE 快照重叠。
  const live: any[] = history.autoApprovalEvents?.length
    ? mergeSessionEvents(history.events, history.autoApprovalEvents)
    : history.events || [];
  const records: QuestionRecord[] = history.questionRecords || [];
  const receiptIds = new Set<string>();
  const boardIds = new Map<string, string[]>((history.executionStarts || [])
    .filter((run: any) => run.boardIds?.length).map((run: any) => [run.id, run.boardIds]));
  const inputs = new Map<string, BoardInput>();
  const bindings = new Map<string, BoardInput>();
  for (const event of live) {
    const { executionId, type, data } = event;
    if (type === "user" && typeof data.text === "string" && (data.nativeText || boardIds.has(executionId))) {
      inputs.set(executionId, { ...data, executionId, boardIds: boardIds.get(executionId) });
    }
    const input = inputs.get(executionId);
    if (!input) continue;
    if (data?.turnId || data?.turn?.id) bindings.set("turn:" + (data.turnId || data.turn.id), input);
    if (data?.uuid && (type === "assistant" || type === "user")) bindings.set("claude:" + data.uuid, input);
  }
  history = { ...history, nativeHistory: displayBoardHistory(history.nativeHistory, bindings) };
  const turns = history.nativeHistory?.thread?.turns || [];
  const sentUserRows = new Map<any, string>();
  type Origin = { turnId?: string; timestamp?: number; executionId?: string };
  const rowOrigins = new Map<string, Origin>();
  const ambiguousRows = new Set<string>();
  const executionStarts = new Map<string, number>(
    (history.executionStarts || []).map((run: { id: string; createdAt: string }) =>
      [run.id, Date.parse(run.createdAt)],
    ),
  );
  let origin: Origin = {};
  const putRow = (id: string, row: any) => {
    const previous = rowOrigins.get(id);
    if ((previous?.turnId && origin.turnId && previous.turnId !== origin.turnId) ||
        (previous?.executionId && origin.executionId && previous.executionId !== origin.executionId))
      ambiguousRows.add(id);
    rows.set(id, row);
    if (Object.keys(origin).length)
      rowOrigins.set(id, { ...rowOrigins.get(id), ...origin });
  };
  for (const record of records) {
    const expected = receiptText(record);
    if (!expected) continue;
    if (
      !record.answerTurnId &&
      !live.some(
        (e: any) =>
          e.executionId === record.executionId &&
          isCodexAsyncQuestion(e.data?.item) &&
          e.data.item.id === record.nativeId,
      )
    )
      continue;
    const matches = (item: any) =>
      item?.type === "userMessage" &&
      item.content?.length === 1 &&
      item.content[0]?.type === "text" &&
      item.content[0].text === expected;
    const items = record.answerTurnId
      ? turns.find((turn: any) => turn.id === record.answerTurnId)?.items || []
      : live
          .filter(
            (event: any) =>
              event.executionId === record.executionId &&
              event.type === "item/completed",
          )
          .map((event: any) => event.data.item);
    const receipts = items.filter(matches);
    if (receipts.length === 1 && receipts[0].id) receiptIds.add(receipts[0].id);
  }
  const nativeCompleted = new Set<string>();
  const textOf = (content: any) =>
    typeof content === "string"
      ? content
      : (Array.isArray(content) ? content : [])
          .filter(
            (c: any) => c && (c.type === "text" || c.type === "input_text"),
          )
          .map((c: any) => c.text)
          .join("\n");
  const nativeOwners = new Map<string, string>();
  const putUser = (id: string, text: string, native = false, owner?: string) => {
    if (!text) return;
    if (native) {
      if (owner) nativeOwners.set(id, owner);
      const ids = nativeUsers.get(text) || [];
      ids.push(id);
      nativeUsers.set(text, ids);
    }
    putRow(id, { id, type: "user", data: { text } });
  };
  const putItem = (item: any) => {
    const id = `item:${item.id}`;
    if (item.type === "userMessage") putUser(id, textOf(item.content), true, item.relayExecutionId);
    else
      putRow(id, { id, type: "item/completed", data: { item: { ...item } } });
  };
  const putClaude = (message: any, native = false) => {
    // SDK 可把同一 message.id 的多个内容块分别发出，uuid 才是块记录的稳定标识。
    const id = `claude:${message.uuid || message.message?.id}`;
    const content = message.message?.content;
    if (message.type === "user") {
      const text = textOf(content);
      const input = origin.executionId && inputs.get(origin.executionId);
      // 实时 Claude 回传可能先于原生历史到达，沿用当前执行已经显示的回显。
      if (text && !(input && !native && boardEcho(text, input)))
        putUser(id, text, native, message.message?.relayExecutionId);
      for (const c of Array.isArray(content) ? content : []) {
        if (c.type !== "tool_result") continue;
        const toolId = `tool:${c.tool_use_id}`;
        const previous = rows.get(toolId);
        putRow(toolId, {
          id: toolId,
          type: "item/completed",
          data: {
            item: {
              ...previous?.data.item,
              rawResult: c,
              id: c.tool_use_id,
              type: previous?.data.item?.type || "tool",
              status: c.is_error ? "失败" : "已完成",
              output:
                typeof c.content === "string"
                  ? c.content
                  : JSON.stringify(c.content, null, 2),
            },
          },
        });
      }
    } else if (message.type === "assistant") {
      for (const [index, c] of (Array.isArray(content)
        ? content
        : []
      ).entries()) {
        if (c.type === "tool_use") {
          const toolId = `tool:${c.id}`;
          const previous = rows.get(toolId)?.data.item;
          putRow(toolId, {
            id: toolId,
            type: "item/completed",
            data: {
              item: {
                ...previous,
                ...c,
                id: c.id,
                type: c.name,
                input: c.input,
                status:
                  previous?.output !== undefined ? previous.status : "执行中",
              },
            },
          });
        } else if (c.type !== "text") {
          const key = `${id}:${index}`;
          putRow(key, {
            id: key,
            type: "item/completed",
            data: {
              item: {
                ...c,
                id: key,
                type: ["thinking", "redacted_thinking"].includes(c.type)
                  ? "reasoning"
                  : c.type,
              },
            },
          });
        } else if (c.type === "text") {
          const key = `${id}:${index}`;
          putRow(key, {
            id: key,
            type: "assistant",
            data: { message: { content: [c] } },
          });
        }
      }
    }
  };
  for (const turn of turns) {
    origin = {
      turnId: turn.id,
      ...(Number.isFinite(turn.startedAt) ? { timestamp: turn.startedAt * 1000 } : {}),
    };
    for (const item of turn.items || []) {
      if (!receiptIds.has(item.id)) putItem(item);
      if (["completed", "failed", "interrupted"].includes(turn.status))
        nativeCompleted.add(item.id);
    }
  }
  if (Array.isArray(history.nativeHistory))
    for (const message of history.nativeHistory) {
      const timestamp = Date.parse(message.timestamp);
      origin = Number.isFinite(timestamp) ? { timestamp } : {};
      putClaude(message, true);
    }

  // 流式重建独立于原生快照，随后以完整消息覆盖，避免把已持久化文本再追加一次。
  const partial = new Map<string, any>();
  let claudeMessage = "";
  const blocks = new Map<number, any>();
  const finalBlocks = new Map<string, any[]>();
  const finalSeen = new Set<string>();
  const nativeMessages = Array.isArray(history.nativeHistory)
    ? history.nativeHistory
    : [];
  for (const message of [
    ...nativeMessages,
    ...live.filter((e: any) => e.type === "assistant").map((e: any) => e.data),
  ]) {
    if (message.type !== "assistant" || !message.message?.id) continue;
    const identity = message.uuid || message.message.id;
    if (finalSeen.has(identity)) continue;
    finalSeen.add(identity);
    const entries = finalBlocks.get(message.message.id) || [];
    for (const content of message.message.content || [])
      entries.push({ content, message });
    finalBlocks.set(message.message.id, entries);
  }
  const completedItems = new Set([
    ...nativeCompleted,
    ...live
      .filter((e: any) => e.type === "item/completed")
      .map((e: any) => e.data.item?.id),
  ]);
  for (const [eventIndex, event] of live.entries()) {
    const { type, data, executionId } = event;
    const turnId = data?.turnId || data?.turn?.id;
    const timestamp = Date.parse(event.timestamp);
    const executionStart = executionStarts.get(executionId);
    origin = {
      ...(executionId ? { executionId } : {}),
      ...(turnId ? { turnId } : {}),
      ...(Number.isFinite(timestamp) ? { timestamp } : {}),
    };
    if (type === "user" && typeof data.text === "string") {
      // 优先匹配原文，再识别完整阶段包装；每条原生输入只抵消一次发送回显。
      const available = (id: string) => !nativeOwners.has(id) || nativeOwners.get(id) === executionId;
      const exact = nativeUsers.get(data.text);
      const matched = exact?.some(available) ? data.text : [...nativeUsers].find(
        ([text, ids]) => ids.some(available) && (matchesUserInput(text, data.text) ||
          (data.nativeText && matchesUserInput(text, data.nativeText))),
      )?.[0];
      if (matched !== undefined) {
        const ids = nativeUsers.get(matched)!;
        // 优先消耗本轮绑定的原生项；上轮同文历史不得抵消尚未入史的新发送。
        const owned = ids.findIndex(id => nativeOwners.get(id) === executionId && !!executionId);
        const [id] = ids.splice(owned < 0 ? ids.findIndex(available) : owned, 1);
        if (data.nativeText) putUser(id, data.text);
        sentUserRows.set(event, id);
      } else {
        const id = `user:${event.executionId}:${event.sequence}`;
        if (!origin.timestamp && executionStart !== undefined)
          origin.timestamp = executionStart;
        putUser(id, data.text);
        sentUserRows.set(event, id);
      }
    } else if (type === "item/started" || type === "item/completed") {
      const item = data.item;
      if (!item || item.type === "userMessage") continue;
      if (
        type === "item/started" &&
        (completedItems.has(item.id) || rows.has(`item:${item.id}`))
      )
        continue;
      putItem({
        ...item,
        status: item.status || (type === "item/started" ? "执行中" : "已完成"),
      });
    } else if (
      type === "item/agentMessage/delta" ||
      type === "item/commandExecution/outputDelta" ||
      type === "item/reasoning/summaryTextDelta" ||
      type === "item/reasoning/textDelta"
    ) {
      if (completedItems.has(data.itemId)) continue;
      const key = `item:${data.itemId}`;
      const value = partial.get(key) || {
        ...rows.get(key)?.data.item,
        id: data.itemId,
        type:
          type === "item/agentMessage/delta"
            ? "agentMessage"
            : type.includes("/reasoning/")
              ? "reasoning"
              : "commandExecution",
        status: "执行中",
      };
      const field =
        type === "item/agentMessage/delta"
          ? "text"
          : type.includes("/reasoning/")
            ? type.includes("summary")
              ? "summaryText"
              : "text"
            : "aggregatedOutput";
      // 第一次增量不接续原生快照的文本；增量自身按完整序列重建。
      value[field] = (partial.has(key) ? value[field] || "" : "") + data.delta;
      partial.set(key, value);
      putItem(value);
    } else if (type === "assistant" || (type === "user" && data.message))
      putClaude(data);
    else if (type === "stream_event") {
      const e = data.event;
      if (e?.type === "message_start") {
        claudeMessage = e.message.id;
        blocks.clear();
      }
      if (!claudeMessage) continue;
      if (e?.type === "content_block_start")
        blocks.set(e.index, { ...e.content_block });
      const block = blocks.get(e?.index);
      if (e?.type === "content_block_delta" && block) {
        if (e.delta.type === "text_delta")
          block.text = (block.text || "") + e.delta.text;
        if (e.delta.type === "thinking_delta")
          block.thinking = (block.thinking || "") + e.delta.thinking;
        if (e.delta.type === "signature_delta")
          block.signature = (block.signature || "") + e.delta.signature;
        if (e.delta.type === "input_json_delta")
          block.inputText = (block.inputText || "") + e.delta.partial_json;
      }
      const finalBlock = finalBlocks.get(claudeMessage)?.[e?.index];
      if (block && finalBlock && finalBlock.content.type === block.type) {
        putClaude(finalBlock.message);
        continue;
      }
      if (block?.type === "text") {
        const key = `claude:${claudeMessage}:${e.index}`;
        putRow(key, {
          id: key,
          type: "assistant",
          data: {
            message: { content: [{ type: "text", text: block.text || "" }] },
          },
        });
      } else if (block && block.type !== "tool_use") {
        const key = `claude:${claudeMessage}:${e.index}`;
        putRow(key, {
          id: key,
          type: "item/completed",
          data: {
            item: {
              ...block,
              id: key,
              type: ["thinking", "redacted_thinking"].includes(block.type)
                ? "reasoning"
                : block.type,
              status: e.type === "content_block_stop" ? "completed" : "running",
            },
          },
        });
      } else if (block?.type === "tool_use") {
        const key = `tool:${block.id}`;
        putRow(key, {
          id: key,
          type: "item/completed",
          data: {
            item: {
              ...block,
              id: block.id,
              type: block.name,
              input: block.inputText || block.input,
              status: "准备调用",
            },
          },
        });
      }
    } else if (type === "relay/approval/auto") {
      // 同次交互的重复投递沿用首次位置，同一调用的多次审批各自保留。
      const id = JSON.stringify(["approval", executionId, data.interactionId ?? event.sequence]);
      if (rows.has(id)) continue;
      putRow(id, { id, type, data });
    } else if (type === "error" || (type === "result" && data.is_error)) {
      const id = `error:${event.executionId}:${event.sequence}`;
      putRow(id, {
        id,
        type,
        data,
        ...(type === "error" && data.willRetry === true
          ? {
              retryState: nativeRetryState(
                event,
                live.slice(eventIndex + 1),
                history.nativeHistory?.thread?.turns || [],
              ),
            }
          : {}),
      });
    }
  }
  // 等历史与增量都投影完毕再关联，允许审批先于工具出现。
  const approvals = [...rows.values()].filter(row => row.type === "relay/approval/auto");
  const owners = new Map<string, Set<string>>();
  for (const approval of approvals) {
    const { itemId } = approval.data;
    const owner = rowOrigins.get(approval.id)?.executionId;
    if (!itemId || !owner) continue;
    const executions = owners.get(itemId) ?? new Set<string>();
    executions.add(owner);
    owners.set(itemId, executions);
  }
  for (const approval of approvals) {
    const { itemId, interactionId, turnId } = approval.data;
    if (!itemId || !interactionId) continue;
    const targets = [rows.get("item:" + itemId), rows.get("tool:" + itemId)]
      .filter(row => row && sessionActivity(row));
    if (targets.length !== 1) continue;
    const target = targets[0];
    if (ambiguousRows.has(target.id)) continue;
    const source = rowOrigins.get(target.id);
    const executionId = rowOrigins.get(approval.id)?.executionId;
    if (!executionId || (source?.executionId && source.executionId !== executionId) ||
        (source?.turnId && turnId && source.turnId !== turnId)) continue;
    // 原生历史没有执行号；同一编号被多轮声明时只能靠明确的回合定位。
    if (!source?.executionId && (!turnId || !source?.turnId) && owners.get(itemId)!.size > 1)
      continue;
    (target.autoApprovals ??= []).push(approval.id);
    rows.delete(approval.id);
  }
  const result = [...rows.values()].map((row) => {
    const source = rowOrigins.get(row.id);
    return source ? { ...row, ...source } : row;
  });
  const insertions = new Map<number, any[]>();
  const replaced = new Set<string>();
  for (const record of records) {
    const claude = record.form.provider === "claude";
    const native = record.questionItemId || record.nativeId;
    const key = (claude ? "tool:" : "item:") + native;
    const item = rows.get(key)?.data.item;
    let position = result.length;
    if (
      claude
        ? item?.type === "AskUserQuestion"
        : isCodexAsyncQuestion(item) ||
          (record.questionItemId &&
            ["requestUserInput", "request_user_input"].includes(item?.type))
    ) {
      position = result.findIndex((row) => row.id === key);
      if (includeQuestions || isCodexAsyncQuestion(item)) replaced.add(key);
    } else if (includeQuestions && record.afterSequence !== undefined) {
      // 仅在边界事件仍在缓冲中时向前找同执行的可见行，避免跨越缺口。
      const before = live.filter(
        (e: any) =>
          e.executionId === record.executionId &&
          e.sequence <= record.afterSequence!,
      );
      if (before.at(-1)?.sequence === record.afterSequence) {
        for (const event of before.reverse()) {
          const id = event.data?.item?.id || event.data?.itemId;
          const rowId = sentUserRows.get(event) || (id && `item:${id}`);
          const index = result.findIndex((row) => row.id === rowId);
          if (index >= 0) {
            position = index + 1;
            break;
          }
        }
      }
    }
    if (includeQuestions) {
      const cards = insertions.get(position) || [];
      cards.push({
        id: `question:${record.executionId}:${record.id}`,
        type: "question",
        record,
      });
      insertions.set(position, cards);
    }
  }
  return result
    .flatMap((row, i) => [
      ...(insertions.get(i) || []),
      ...(replaced.has(row.id) ? [] : [row]),
    ])
    .concat(insertions.get(result.length) || []);
}

/** 将不同 CLI 的结构转成共用活动卡片；未知字段始终保留原始数据，避免静默丢失。 */
export function sessionActivity(event: any) {
  if (
    event.type !== "item/completed" ||
    event.data?.item?.type === "agentMessage" ||
    event.data?.item?.type === "userMessage"
  )
    return null;
  const item = event.data?.item;
  const status =
    (
      {
        执行中: "running",
        准备调用: "running",
        已完成: "completed",
        失败: "failed",
        inProgress: "running",
      } as Record<string, string>
    )[item?.status] ||
    item?.status ||
    "completed";
  return {
    id: event.id,
    name:
      [item?.tool, item?.name, item?.type].find(
        (value) => typeof value === "string" && value,
      ) || "tool",
    status: typeof status === "string" ? status : "unknown",
    arguments:
      item?.input ??
      item?.arguments ??
      (item?.command !== undefined
        ? { command: item.command, cwd: item.cwd }
        : undefined),
    output: item?.output ?? item?.aggregatedOutput ?? item?.result,
    raw: item ?? event.data,
    ...(event.autoApprovals && { autoApprovals: event.autoApprovals }),
  };
}

/** 仅合并相邻活动，用户输入和正文保持原有顺序；正文出现后自动收起前面的活动。 */
export function sessionTimeline(events: any[]) {
  const groups: any[] = [];
  for (const event of events) {
    const block = sessionActivity(event);
    if (!block) groups.push({ id: event.id, event });
    else {
      const previous = groups.at(-1);
      if (previous?.blocks) previous.blocks.push(block);
      else groups.push({ id: event.id, blocks: [block] });
    }
  }
  // 每轮用户输入只展示一次回答身份，工具与状态事件不重置轮次。
  let identityShown = false;
  for (const group of groups) {
    const event = group.event;
    if (event?.type === "user") identityShown = false;
    const answer =
      (event?.type === "item/completed" &&
        event.data?.item?.type === "agentMessage") ||
      (event?.type === "assistant" &&
        event.data?.message?.content?.some(
          (block: any) => block.type === "text",
        ));
    group.showIdentity = Boolean(answer && !identityShown);
    if (answer) identityShown = true;
  }
  for (let i = 0; i < groups.length; i++) {
    if (!groups[i].blocks) continue;
    // 不跨用户轮次判断，避免新任务错误改变旧活动的展开状态。
    groups[i].followedByText = false;
    for (const next of groups.slice(i + 1)) {
      if (next.event?.type === "user") break;
      if (
        next.event?.data?.item?.text ||
        next.event?.data?.message?.content?.some(
          (c: any) => c.type === "text" && c.text,
        )
      ) {
        groups[i].followedByText = true;
        break;
      }
    }
  }
  return groups;
}
