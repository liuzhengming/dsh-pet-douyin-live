/**
 * 结构探针：打开直播间，把右侧面板和「聊天」相关控件的结构打出来，用于校准。
 * 用法：node src/probe.mjs --room 123456789 [--wait 8000]
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
const wait = Number(arg('wait', 8000));
if (!room) {
  console.error('用法：node src/probe.mjs --room <房间号>');
  process.exit(1);
}

const { context, page } = await openRoom({
  roomId: room,
  profileDir: path.join(ROOT, 'browser-profile'),
});
await page.waitForTimeout(wait);

const report = await page.evaluate(() => {
  const out = { viewport: [window.innerWidth, window.innerHeight], chatish: [], rightPanel: [] };

  const rect = (el) => {
    const r = el.getBoundingClientRect();
    return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)];
  };
  const cls = (el) => (typeof el.className === 'string' ? el.className.slice(0, 100) : '');

  // 所有「说了聊天/弹幕/互动」字样的可点元素
  for (const el of document.querySelectorAll('div,span,button,a,li')) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 12) continue;
    if (!/聊天|弹幕|互动|观众|贡献/.test(t)) continue;
    out.chatish.push({ tag: el.tagName, cls: cls(el), text: t, box: rect(el), role: el.getAttribute('role') ?? '' });
    if (out.chatish.length >= 25) break;
  }

  // 右侧 40% 区域的直接子容器
  const vw = window.innerWidth;
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width < 200 || r.height < 200) continue;
    if (r.x < vw * 0.55) continue;
    if (r.width > vw * 0.9) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    out.rightPanel.push({
      tag: el.tagName,
      cls: cls(el),
      box: rect(el),
      children: el.childElementCount,
      textHead: t.slice(0, 60),
    });
    if (out.rightPanel.length >= 15) break;
  }

  // 消息类节点（礼物/进场/聊天输入）及其祖先链
  out.messages = [];
  const chain = (el) => {
    const parts = [];
    let node = el;
    for (let i = 0; i < 6 && node && node.nodeType === 1; i += 1) {
      parts.push({ tag: node.tagName, cls: cls(node), box: rect(node), children: node.childElementCount });
      node = node.parentElement;
    }
    return parts;
  };
  const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 60) continue;
    if (!/送 .+|加入了直播间|说点什么|发送/.test(t)) continue;
    if (el.childElementCount > 6) continue;
    const key = t + '|' + rect(el).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    out.messages.push({ text: t, chain: chain(el) });
    if (out.messages.length >= 6) break;
  }
  return out;
});

console.log(JSON.stringify(report, null, 2));
await context.close().catch(() => {});
