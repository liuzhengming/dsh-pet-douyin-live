import assert from 'node:assert/strict';
import test from 'node:test';
import { createBubbleWatcher } from '../src/bubble-watcher.mjs';
import { markSpoken, resetSpoken, wasRecentlySpoken } from '../src/speech-ledger.mjs';

const petState = (counter, text) => ({ pets: { main: { say: { counter, data: { text, image: null } } } } });

test('气泡监听：首轮只记基线，不念历史气泡', async () => {
  const got = [];
  let state = petState(100, '旧气泡');
  const w = createBubbleWatcher({
    getConfig: () => ({ pet: { enabled: true, baseUrl: 'http://x', petId: 'main' }, bubble: { enabled: true } }),
    fetchJson: async () => state,
    onBubble: (b) => got.push(b.text),
  });
  await w.tick();
  assert.deepEqual(got, []);
});

test('气泡监听：counter 变了就念，没变不重复', async () => {
  const got = [];
  let state = petState(100, '第一句');
  const w = createBubbleWatcher({
    getConfig: () => ({ pet: { enabled: true, baseUrl: 'http://x', petId: 'main' }, bubble: { enabled: true } }),
    fetchJson: async () => state,
    onBubble: (b) => got.push(b.text),
  });
  await w.tick();
  state = petState(101, '摆摆还没卸妆？那咱俩一起熬着～');
  await w.tick();
  await w.tick();
  assert.deepEqual(got, ['摆摆还没卸妆？那咱俩一起熬着～']);
});

test('气泡监听：关掉开关就完全不读', async () => {
  const got = [];
  let state = petState(1, 'a');
  const w = createBubbleWatcher({
    getConfig: () => ({ pet: { enabled: true, baseUrl: 'http://x', petId: 'main' }, bubble: { enabled: false } }),
    fetchJson: async () => state,
    onBubble: (b) => got.push(b.text),
  });
  await w.tick();
  state = petState(2, 'b');
  await w.tick();
  assert.deepEqual(got, []);
});

test('气泡监听：桌宠没开时不抛错', async () => {
  const errors = [];
  const w = createBubbleWatcher({
    getConfig: () => ({ pet: { enabled: true, baseUrl: 'http://x', petId: 'main' }, bubble: { enabled: true } }),
    fetchJson: async () => {
      throw new Error('connect ECONNREFUSED');
    },
    onBubble: () => {},
    onError: (e) => errors.push(e.message),
  });
  await w.tick();
  assert.equal(errors.length, 1);
});

test('speech-ledger：刚念过的会被标记，过期后放行', () => {
  resetSpoken();
  markSpoken('你好');
  assert.equal(wasRecentlySpoken('你好'), true);
  assert.equal(wasRecentlySpoken('  你好  '), true);
  assert.equal(wasRecentlySpoken('别的话'), false);
  assert.equal(wasRecentlySpoken('你好', Date.now() + 60_000), false);
  resetSpoken();
});
