/**
 * 一次性登录：打开 Edge，等你在窗口里扫码登录抖音，登录态存进 browser-profile。
 * 之后 inspect / bridge 都用同一份 profile，不用再登。
 *
 * 用法：node src/login.mjs [--timeout 300]
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

const timeoutSec = Number(arg('timeout', 300));
const profileDir = arg('profile') || path.join(ROOT, 'browser-profile');

const { context, page } = await openRoom({
  url: 'https://www.douyin.com/',
  profileDir,
  headless: false,
});

async function loggedIn() {
  try {
    const cookies = await context.cookies('https://www.douyin.com');
    return cookies.some((c) => ['sessionid', 'sessionid_ss', 'sid_tt'].includes(c.name) && c.value);
  } catch {
    return false;
  }
}

console.log('浏览器已打开。请在窗口里扫码登录抖音（右上角「登录」）。');
console.log('登录成功后我会自动关闭窗口并保存登录态。');

const deadline = Date.now() + timeoutSec * 1000;
let ok = false;
while (Date.now() < deadline) {
  if (await loggedIn()) {
    ok = true;
    break;
  }
  await page.waitForTimeout(2000);
}

if (ok) {
  console.log('已检测到登录态，保存中…');
  // 给站点一点时间把 cookie 落盘
  await page.waitForTimeout(3000);
  await context.close();
  console.log('完成。现在可以跑：npm run inspect -- --room <房间号>');
  process.exit(0);
}

console.log(`等待 ${timeoutSec}s 仍未检测到登录态，窗口保持关闭。可以重跑本命令再试。`);
await context.close();
process.exit(2);
