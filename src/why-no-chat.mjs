/**
 * 为什么聊天不可用：把「聊天功能不可用」那句话附近的 DOM 原样打出来。
 * 用法：node src/why-no-chat.mjs --room 123456789
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
if (!room) {
  console.error('用法：node src/why-no-chat.mjs --room <房间号>');
  process.exit(1);
}

const { context, page } = await openRoom({
  roomId: room,
  profileDir: path.join(ROOT, 'browser-profile'),
});
await page.waitForTimeout(7000);

const report = await page.evaluate(() => {
  const out = { found: false, notes: [] };
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const t = (node.textContent || '').trim();
    if (!t.includes('聊天功能不可用') && !t.includes('无法评论') && !t.includes('其他地方')) continue;
    out.found = true;
    const el = node.parentElement;
    let box = el;
    for (let i = 0; i < 3 && box?.parentElement; i += 1) box = box.parentElement;
    out.notes.push({
      text: t,
      el: { tag: el.tagName, cls: String(el.className).slice(0, 80), title: el.getAttribute('title') ?? '', aria: el.getAttribute('aria-label') ?? '' },
      outer: (box?.outerHTML ?? '').slice(0, 600),
    });
    if (out.notes.length >= 4) break;
  }

  // 聊天输入框是否存在
  const inputs = [...document.querySelectorAll('input,textarea,[contenteditable="true"]')].map((el) => ({
    tag: el.tagName,
    placeholder: el.getAttribute('placeholder') ?? '',
    cls: String(el.className).slice(0, 60),
    visible: el.getBoundingClientRect().width > 0,
  }));
  out.inputs = inputs.slice(0, 10);
  return out;
});

console.log(JSON.stringify(report, null, 2));
await context.close().catch(() => {});
