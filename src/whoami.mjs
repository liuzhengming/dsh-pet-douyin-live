/**
 * 诊断：当前 profile 到底是不是登录态。
 * 只打印 cookie 名/域/过期时间，不打印值。
 * 用法：node src/whoami.mjs [--room 123456789]
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

const room = arg('room');
const { context, page } = await openRoom({
  url: room ? `https://live.douyin.com/${room}` : 'https://www.douyin.com/',
  profileDir: path.join(ROOT, 'browser-profile'),
});

await page.waitForTimeout(6000);

const cookies = await context.cookies('https://www.douyin.com');
const interesting = ['sessionid', 'sessionid_ss', 'sid_tt', 'uid_tt', 'passport_csrf_token', 'ttwid', 'odin_tt', 's_v_web_id'];
console.log('关键 cookie：');
for (const name of interesting) {
  const c = cookies.find((x) => x.name === name);
  const exp = c ? new Date(c.expires * 1000).toISOString().slice(0, 19) : '-';
  console.log(`  ${name.padEnd(20)} ${c ? `有，expires ${exp}` : '无'}`);
}
console.log(`cookie 总数：${cookies.length}`);

const ui = await page.evaluate(() => {
  const text = document.body.innerText || '';
  return {
    url: location.href,
    hasLoginButton: /^\s*登录\s*$/m.test(text) || text.includes('登录'),
    chatDisabled: text.includes('聊天功能不可用'),
    textHead: text.replace(/\s+/g, ' ').slice(0, 300),
  };
});
console.log('\n页面状态：', JSON.stringify(ui, null, 2));

await context.close().catch(() => {});
