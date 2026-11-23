import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { AppError } from "../src/shared/contracts.js";
import {
  boardToolError,
  boardToolParameters,
  parseBoardWrite,
} from "../src/server/board-tool.js";

/** 错误只暴露可修正的字段，未知内部异常和输入内容不进入工具结果。 */
test("看板工具错误脱敏与流程不变量", () => {
  for (const error of [
    new Error("secret-fixture"),
    new AppError("INTERNAL", "secret-fixture"),
  ]) {
    assert.doesNotMatch(boardToolError(error), /secret-fixture/);
  }
  const first = randomUUID(),
    last = randomUUID();
  const board = {
    name: "测试",
    projectId: randomUUID(),
    stages: [
      {
        fixedRole: "start",
        id: first,
        name: "人工",
        type: "human",
        targets: [last],
      },
      { id: last, name: "结束", type: "done", targets: [] },
    ],
  };
  const invalid = [
    {
      ...board,
      stages: board.stages.map((stage) => ({ ...stage, type: "human" })),
    },
    {
      ...board,
      stages: board.stages.map((stage) => ({
        ...stage,
        type: "done",
        targets: [],
      })),
    },
    {
      ...board,
      stages: board.stages.map((stage) => ({ ...stage, id: first })),
    },
    {
      ...board,
      stages: [{ ...board.stages[0], type: "agent" }, board.stages[1]],
    },
    {
      ...board,
      stages: [{ ...board.stages[0], id: "secret-fixture" }, board.stages[1]],
    },
  ];
  for (const value of invalid) {
    assert.throws(
      () => parseBoardWrite({ action: "create", board: value }),
      (error) => {
        const output = boardToolError(error);
        assert.match(output, /VALIDATION_ERROR/);
        assert.match(output, /board.stages/);
        assert.doesNotMatch(output, /secret-fixture/);
        return true;
      },
    );
  }
  assert.equal(boardToolParameters.properties.data, undefined);
  assert.ok(boardToolParameters.required.includes("action"));
  assert.throws(() =>
    parseBoardWrite({ data: JSON.stringify({ action: "create", board }) }),
  );
  assert.throws(() =>
    parseBoardWrite({
      data: JSON.stringify({ action: "create", board }),
      action: "delete",
    }),
  );
  assert.throws(() =>
    parseBoardWrite({ action: "update", board, id: randomUUID() }),
  );
  assert.throws(() => parseBoardWrite({ action: "delete", id: "invalid" }));
});
