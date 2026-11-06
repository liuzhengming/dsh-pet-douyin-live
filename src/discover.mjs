/**
 * 找房间：打开直播首页，列出当前在线房间，挑一个进去。
 * 用法：node src/discover.mjs [--limit 8] [--enter]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose, openRoom } from './capture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const limit = Number(arg('limit', 8));
const enter = Boolean(arg('enter'));

const { context, page } = await openRoom({ url: 'https://live.douyin.com/', profileDir: path.join(ROOT, 'browser-profile') });
await page.waitForTimeout(6000);

const rooms = await page.evaluate((max) => {
  const seen = new Set();
  const out = [];
  for (const a of document.querySelectorAll('a[href]')) {
    let u;
    try {
      u = new URL(a.href, location.href);
    } catch {
      continue;
    }
    if (u.origin !== 'https://live.douyin.com') continue;
    const id = /^\/(\d{4,30})\/?$/.exec(u.pathname)?.[1];
    if (!id || seen.has(id)) continue;
    const text = (a.innerText || a.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim().slice(0, 80);
    if (!text) continue;
    seen.add(id);
    out.push({ id, text });
    if (out.length >= max) break;
  }
  return out;
}, limit);

if (!rooms.length) {
  console.log('首页没找到房间链接，可能被风控或改版了。');
} else {
  console.log(`找到 ${rooms.length} 个房间：`);
  for (const r of rooms) console.log(`  ${r.id}  ${r.text}`);
}

if (enter && rooms.length) {
  const target = rooms[0];
  console.log(`\n进入 ${target.id}（${target.text}）…`);
  await page.goto(`https://live.douyin.com/${target.id}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
  await page.waitForTimeout(8000);
  const info = await diagnose(page);
  console.log(JSON.stringify(info, null, 2).slice(0, 3000));
}

await context.close().catch(() => {});
