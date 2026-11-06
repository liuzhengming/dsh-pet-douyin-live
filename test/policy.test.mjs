import assert from 'node:assert/strict';
import test from 'node:test';
import { createReplyPolicy } from '../src/policy.mjs';

const cfg = {
  minIntervalSec: 20,
  maxPerMinute: 3,
  giftCooldownSec: 8,
  keywordCooldownSec: 10,
  chatProbability: 0.35,
  keywords: ['鱼'],
  maxBatch: 6,
};

const baseState = () => ({ lastReplyAt: 0, lastGiftAt: 0, lastKeywordAt: 0, replies: [], fresh: 1 });
const chat = (text = '主播好', user = '小明') => ({ kind: 'chat', user, text });
const gift = () => ({ kind: 'gift', user: '土豪', text: '送出 玫瑰 ×1' });

test('冷却期内不回复', () => {
  const p = createReplyPolicy(cfg);
  const state = { ...baseState(), lastReplyAt: 1_000 };
  assert.equal(p.decide([chat()], state, 5_000, () => 0), null);
});

test('冷却结束、普通弹幕按概率放行', () => {
  const p = createReplyPolicy(cfg);
  const state = { ...baseState(), lastReplyAt: 0 };
  const hit = p.decide([chat()], state, 30_000, () => 0.1);
  assert.equal(hit?.reason, 'chat');
  const miss = p.decide([chat()], state, 30_000, () => 0.9);
  assert.equal(miss, null);
});

test('礼物优先，且受自己的冷却约束', () => {
  const p = createReplyPolicy(cfg);
  const state = baseState();
  assert.equal(p.decide([gift()], state, 30_000, () => 0.99)?.reason, 'gift');
  state.lastGiftAt = 29_000;
  assert.equal(p.decide([gift()], state, 30_000, () => 0.99), null);
});

test('叫到名字更积极（不靠概率）', () => {
  const p = createReplyPolicy(cfg);
  const state = baseState();
  const hit = p.decide([chat('鱼你在干嘛')], state, 30_000, () => 0.99);
  assert.equal(hit?.reason, 'keyword');
});

test('每分钟上限压住刷屏', () => {
  const p = createReplyPolicy(cfg);
  const state = { ...baseState(), lastReplyAt: 0, replies: [1, 2, 3].map((n) => 29_000 + n * 100) };
  assert.equal(p.decide([gift()], state, 60_000, () => 0), null);
});

test('没有新消息不回复', () => {
  const p = createReplyPolicy(cfg);
  const state = { ...baseState(), fresh: 0 };
  assert.equal(p.decide([chat()], state, 30_000, () => 0), null);
});

test('batch 只取最后 maxBatch 条', () => {
  const p = createReplyPolicy(cfg);
  const many = Array.from({ length: 20 }, (_, i) => chat(`第${i}条`));
  const hit = p.decide(many, baseState(), 30_000, () => 0);
  assert.equal(hit.batch.length, cfg.maxBatch);
  assert.equal(hit.batch.at(-1).text, '第19条');
});
