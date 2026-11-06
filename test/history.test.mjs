import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createHistory } from '../src/history.mjs';

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-his-'));
  return { dir, file: path.join(dir, 'history.jsonl') };
}

test('history：追加后能按时间正序读回', () => {
  const { dir, file } = tempFile();
  const h = createHistory({ file });
  h.append({ kind: 'chat', user: '小明', text: '主播好', reply: '你好呀' });
  h.append({ kind: 'gift', user: '土豪', text: '送出 玫瑰 ×1', reply: '谢谢土豪～' });
  const list = h.list(10);
  assert.equal(list.length, 2);
  assert.equal(list[0].text, '主播好');
  assert.equal(list[1].reply, '谢谢土豪～');
  assert.ok(list[0].ts <= list[1].ts);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('history：limit 取最近 N 条', () => {
  const { dir, file } = tempFile();
  const h = createHistory({ file });
  for (let i = 0; i < 10; i += 1) h.append({ kind: 'chat', user: `u${i}`, text: `第${i}条`, reply: null });
  const list = h.list(3);
  assert.equal(list.length, 3);
  assert.equal(list.at(-1).text, '第9条');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('history：清空后为空，坏行被跳过', () => {
  const { dir, file } = tempFile();
  const h = createHistory({ file });
  h.append({ kind: 'chat', user: 'a', text: 'x', reply: 'y' });
  fs.appendFileSync(file, '这不是 JSON\n', 'utf8');
  assert.equal(h.list(10).length, 1);
  h.clear();
  assert.deepEqual(h.list(10), []);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('history：超过上限会截断，文件不会无限长', () => {
  const { dir, file } = tempFile();
  const h = createHistory({ file, limit: 5 });
  for (let i = 0; i < 20; i += 1) h.append({ kind: 'chat', user: 'a', text: `第${i}条`, reply: 'r' });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.ok(lines.length <= 10, `实际 ${lines.length} 行`);
  assert.equal(JSON.parse(lines.at(-1)).text, '第19条');
  fs.rmSync(dir, { recursive: true, force: true });
});
