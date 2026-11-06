/**
 * 弹幕到底在不在 DOM 里：扫描播放器左下区域的所有短文本节点。
 * 用法：node src/where-danmaku.mjs --room 123456789 [--wait 15000]
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
const wait = Number(arg('wait', 15000));

const { context, page } = await openRoom({ roomId: room, profileDir: path.join(ROOT, 'browser-profile') });
await page.waitForTimeout(wait);

const report = await page.evaluate(() => {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const rows = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.shadowRoot) rows.push({ shadow: true, cls: String(el.className).slice(0, 60) });
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    if (r.width > vw * 0.7) continue; // 只看窄块
    if (r.y < vh * 0.35) continue; // 只看下半屏
    if (el.childElementCount > 2) continue;
    const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length < 2 || t.length > 80) continue;
    rows.push({ text: t, cls: String(el.className).slice(0, 70), box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)] });
    if (rows.length > 60) break;
  }
  return {
    iframes: [...document.querySelectorAll('iframe')].map((f) => f.src.slice(0, 80)),
    shadowHosts: rows.filter((r) => r.shadow).length,
    rows: rows.filter((r) => !r.shadow),
  };
});

console.log(JSON.stringify(report, null, 2));
await context.close().catch(() => {});
