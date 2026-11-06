/**
 * 校准工具：打开直播间，把采集器看到的东西原样打出来。
 *
 * 用法：
 *   node src/inspect.mjs --room 123456789
 *   node src/inspect.mjs --room 123456789 --seconds 90
 *   node src/inspect.mjs --room 123456789 --html   额外把聊天区 HTML 存到 inspect/
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { containerHtml, diagnose, drain, openRoom } from './capture.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

const room = arg('room') || process.env.ROOM_ID;
const url = arg('url');
const seconds = Number(arg('seconds', 60));
const wantHtml = Boolean(arg('html'));
const headless = Boolean(arg('headless'));
const profile = arg('profile');

if (!room && !url) {
  console.error('用法：node src/inspect.mjs --room <直播间号> [--seconds 60] [--html]');
  process.exit(1);
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
console.log(`打开 ${url ?? `https://live.douyin.com/${room}`}，采集 ${seconds}s…`);

const { context, page, navError } = await openRoom({
  roomId: room,
  url,
  headless,
  profileDir: profile || path.join(ROOT, 'browser-profile'),
});
if (navError) console.log(`页面加载告警：${navError.message}`);

const deadline = Date.now() + seconds * 1000;
let lastDiag = 0;
let printed = 0;

while (Date.now() < deadline) {
  const records = await drain(page);
  for (const rec of records) {
    printed += 1;
    const inside = rec.inChat === true ? 'IN ' : rec.inChat === false ? 'OUT' : '?  ';
    console.log(`${inside} ${rec.text}`);
    if (rec.cls) console.log(`     cls: ${rec.cls}`);
  }

  if (Date.now() - lastDiag > 10_000) {
    lastDiag = Date.now();
    const info = await diagnose(page);
    console.log(
      `\n--- ${new Date().toISOString().slice(11, 19)} 诊断：容器 ${info?.chatRoots ?? '?'} / 已收 ${info?.hits ?? '?'} / 登录墙 ${info?.loginWall ? '是' : '否'} / 弹幕可用 ${info?.chatDisabled ? '否' : '是'} / 直播结束 ${info?.liveEnded ? '是' : '否'} ---`,
    );
    for (const c of info?.candidates ?? []) {
      console.log(`  容器 ${JSON.stringify(c.box)} rows=${c.rows} cls=${c.cls}`);
      for (const s of c.sample) console.log(`    · ${s}`);
    }
    console.log('');
  }

  await new Promise((r) => setTimeout(r, 400));
}

if (wantHtml) {
  const html = await containerHtml(page, 0);
  if (html) {
    const dir = path.join(ROOT, 'inspect');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `chat-${stamp}.html`);
    fs.writeFileSync(file, html, 'utf8');
    console.log(`聊天区 HTML 已存：${file}`);
  } else {
    console.log('没找到聊天区容器，HTML 没存。');
  }
}

console.log(`\n共打出 ${printed} 条文本。关闭浏览器。`);
await context.close().catch(() => {});
