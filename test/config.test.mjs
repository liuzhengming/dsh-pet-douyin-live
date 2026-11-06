import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DEFAULTS, normalizeConfig, normalizeRoom, readConfig, resolvePetBaseUrl, writeConfig } from '../src/config.mjs';

test('normalizeRoom：房间号与链接都认', () => {
  assert.equal(normalizeRoom('123456789'), '123456789');
  assert.equal(normalizeRoom('https://live.douyin.com/123456789'), '123456789');
  assert.equal(normalizeRoom('https://live.douyin.com/123456789?foo=1'), '123456789');
  assert.equal(normalizeRoom('  '), '');
  assert.equal(normalizeRoom('随便一个词'), '');
});

test('normalizeConfig：越界值被夹回合法范围', () => {
  const { config } = normalizeConfig({
    reply: { minIntervalSec: 1, maxPerMinute: 999, chatProbability: 5, maxBatch: 100 },
    tts: { volume: 500 },
    capture: { pollMs: 5 },
  });
  assert.equal(config.reply.minIntervalSec, 5);
  assert.equal(config.reply.maxPerMinute, 60);
  assert.equal(config.reply.chatProbability, 1);
  assert.equal(config.reply.maxBatch, 20);
  assert.equal(config.tts.volume, 100);
  assert.equal(config.capture.pollMs, 150);
});

test('normalizeConfig：非法房间号与非法语音引擎给出错误但不崩', () => {
  const bad = normalizeConfig({ roomId: '不是房间号', tts: { engine: 'nope' } });
  assert.equal(bad.config.roomId, '');
  assert.equal(bad.config.tts.engine, 'edge');
  assert.ok(bad.errors.length >= 1);
});

test('normalizeConfig：外接语音必须带 http 地址', () => {
  const { errors } = normalizeConfig({ tts: { engine: 'http', endpoint: 'ws://x' } });
  assert.ok(errors.some((e) => e.includes('http')));
});

test('normalizeConfig：关键词去空去重上限', () => {
  const { config } = normalizeConfig({ reply: { keywords: [' 鱼 ', '', '鱼', '主播'] } });
  assert.deepEqual(config.reply.keywords, ['鱼', '主播']);
});

test('resolvePetBaseUrl：本机地址跟随端口，非本机地址原样用', () => {
  assert.equal(resolvePetBaseUrl('', 52802), 'http://127.0.0.1:52802');
  assert.equal(resolvePetBaseUrl('', 0), 'http://127.0.0.1:52718');
  // 旧配置里存下的本机端口不能再信
  assert.equal(resolvePetBaseUrl('http://127.0.0.1:52718', 52802), 'http://127.0.0.1:52802');
  assert.equal(resolvePetBaseUrl('http://localhost:1111', 52802), 'http://127.0.0.1:52802');
  assert.equal(resolvePetBaseUrl('http://192.168.1.5:8000/', 52802), 'http://192.168.1.5:8000');
});

test('writeConfig / readConfig：往返一致，坏文件不致命', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dlp-cfg-'));
  const file = path.join(dir, 'config.json');
  const saved = writeConfig({ roomId: '123456789', tts: { voice: 'zh-CN-YunxiNeural' } }, file);
  assert.equal(saved.ok, true);
  const read = readConfig(file);
  assert.equal(read.roomId, '123456789');
  assert.equal(read.tts.voice, 'zh-CN-YunxiNeural');
  assert.deepEqual(read.errors, []);

  fs.writeFileSync(file, '{ 坏掉的 json', 'utf8');
  const broken = readConfig(file);
  assert.equal(broken.roomId, DEFAULTS.roomId);
  assert.ok(broken.errors.length === 1);
  fs.rmSync(dir, { recursive: true, force: true });
});
