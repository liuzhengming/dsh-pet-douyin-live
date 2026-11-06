import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPrompt, classify, createDeduper, parseRecord } from '../src/parser.mjs';

test('classify：常见行归类', () => {
  assert.equal(classify('小明：主播好'), 'chat');
  assert.equal(classify('小明 送出了 小心心 ×3'), 'gift');
  assert.equal(classify('小明 来了'), 'enter');
  assert.equal(classify('小明 为主播点赞了'), 'like');
  assert.equal(classify(''), 'empty');
});

test('classify：聊天里出现「送你」不算礼物', () => {
  assert.equal(classify('小红：送你一朵花'), 'chat');
  assert.equal(classify('小红 送出了 玫瑰 ×1'), 'gift');
});

test('parseRecord：弹幕拆出昵称与内容', () => {
  const m = parseRecord({ text: '阿强：这个操作笑死我了', ts: 123 });
  assert.equal(m.kind, 'chat');
  assert.equal(m.user, '阿强');
  assert.equal(m.text, '这个操作笑死我了');
  assert.equal(m.ts, 123);
});

test('parseRecord：没有冒号时整条当内容，不丢消息', () => {
  const m = parseRecord({ text: '主播快跑' });
  assert.equal(m.kind, 'chat');
  assert.equal(m.user, null);
  assert.equal(m.text, '主播快跑');
});

test('parseRecord：礼物解析出礼物名与数量', () => {
  const m = parseRecord({ text: '土豪哥 送出了 嘉年华 ×2' });
  assert.equal(m.kind, 'gift');
  assert.equal(m.user, '土豪哥');
  assert.equal(m.gift, '嘉年华');
  assert.equal(m.count, 2);
});

test('parseRecord：进场与点赞', () => {
  assert.equal(parseRecord({ text: '路人甲 来了' }).kind, 'enter');
  assert.equal(parseRecord({ text: '路人甲 为主播点赞了' }).kind, 'like');
});

test('parseRecord：UI 噪声与空文本被丢掉', () => {
  assert.equal(parseRecord({ text: '关注' }), null);
  assert.equal(parseRecord({ text: '   ' }), null);
  assert.equal(parseRecord({}), null);
});

test('parseRecord：价目表、榜单、升级提示、空评论都不算消息', () => {
  assert.equal(parseRecord({ text: '99钻 Thuglife 99钻' }), null);
  assert.equal(parseRecord({ text: '1 聪哥｜巨航' }), null);
  assert.equal(parseRecord({ text: '恭喜杨你一脸沙子刚刚升级至Lv.18' }), null);
  assert.equal(parseRecord({ text: '心碎小鱼：' }), null);
  assert.equal(parseRecord({ text: '用户123 推荐了直播' }), null);
  assert.equal(parseRecord({ text: '账号已在其他地方进入直播间 继续看播' }), null);
});

test('createDeduper：窗口期内重复算重，窗口外放行', async () => {
  const dup = createDeduper({ windowMs: 50 });
  assert.equal(dup('同一句'), false);
  assert.equal(dup('同一句'), true);
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(dup('同一句'), false);
});

test('buildPrompt：把一批消息压成提示词', () => {
  const prompt = buildPrompt([
    { kind: 'chat', user: '小明', text: '主播好' },
    { kind: 'gift', user: '土豪', text: '送出 玫瑰 ×3' },
  ]);
  assert.match(prompt, /弹幕：小明：主播好/);
  assert.match(prompt, /礼物：土豪 送出 玫瑰 ×3/);
  assert.match(prompt, /20 字以内/);
});

test('buildPrompt：空批次返回 null', () => {
  assert.equal(buildPrompt([]), null);
});
