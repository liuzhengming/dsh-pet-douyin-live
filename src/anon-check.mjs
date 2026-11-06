/**
 * 匿名（未登录）能不能看到弹幕：用全新 profile 打开直播间，看 DOM 里到底有什么。
 * 用法：node src/anon-check.mjs --room 123456789 [--profile browser-profile-anon]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openRoom } from './capture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const room = arg('room') || process.env.ROOM_ID;
const profile = arg('profile') || 'browser-profile-anon';

if (!room) {
  console.error('用法：node src/anon-check.mjs --room <房间号> [--profile browser-profile-anon]');
  process.exit(1);
}

const { context, page } = await openRoom({
  roomId: room,
  profileDir: path.join(ROOT, String(profile)),
});
await page.waitForTimeout(30_000);

const report = await page.evaluate(() => {
  const bodyText = document.body.innerText || '';
  const chatroom = document.querySelectorAll('[class*="chatroom"]');
  const items = [...document.querySelectorAll('[class*="webcast-chatroom___item"]')];
  const canvasDanmaku = document.querySelectorAll('[class*="CanvasDanmaku"]');
  const box = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };
  return {
    hasLoginButton: /^\s*登录\s*$/m.test(bodyText),
    chatroomCount: chatroom.length,
    chatroomBoxes: [...chatroom].slice(0, 3).map(box),
    itemCount: items.length,
    itemSamples: items.slice(-10).map((el) => (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 60)),
    canvasDanmakuCount: canvasDanmaku.length,
    canvasBoxes: [...canvasDanmaku].slice(0, 2).map(box),
    saysNeedLogin: bodyText.includes('需先登录') || bodyText.includes('聊天功能不可用'),
  };
});

console.log(JSON.stringify(report, null, 2));
await context.close().catch(() => {});
