import test from "node:test";
import assert from "node:assert/strict";
import { updateEn, updateZh } from "../src/web/connector-update-messages.js";
import {
  updateMessages,
  updateStates,
} from "../src/shared/connector-update.js";

/** 状态与安全错误必须双语覆盖，新增协议枚举时禁止静默漏译。 */
test("连接器更新双语资源覆盖协议状态与错误", () => {
  assert.deepEqual(Object.keys(updateEn).sort(), Object.keys(updateZh).sort());
  for (const key of [...updateStates, ...Object.keys(updateMessages)]) {
    assert.ok(updateZh[key as keyof typeof updateZh]);
    assert.ok(updateEn[key as keyof typeof updateEn]);
  }
  for (const value of Object.values(updateEn))
    assert.ok(value.trim() && !/[\u4e00-\u9fff]/.test(value));
});
