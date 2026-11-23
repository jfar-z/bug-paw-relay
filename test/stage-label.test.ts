import test from 'node:test';
import assert from 'node:assert/strict';
import { stageLabel } from '../src/web/stage-label.js';

/** 双语资源结构与历史缺失编号不可伪造的展示契约。 */
test('默认英文展示，缺失编号与草稿明确区分', () => {
  assert.equal(stageLabel({ shortId: 'S18', name: '同名' }), 'S18 · 同名');
  assert.match(stageLabel({ name: '新阶段' }, true), /Number assigned after saving/);
  assert.match(stageLabel({ name: '旧阶段' }), /Invalid stage number/);
  assert.equal(stageLabel(undefined), 'Original stage deleted');
});
