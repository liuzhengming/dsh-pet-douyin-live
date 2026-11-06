/**
 * 打开抖音直播间并持续取回采集器记录的文本。
 * 用真的 Edge（channel: msedge）+ 独立 profile，登录态能留下来，
 * 也不容易一上来就被判定成自动化。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { installCollector } from './inpage.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

export const DEFAULT_PROFILE = path.join(PROJECT_ROOT, 'browser-profile');

/**
 * @param {{roomId?: string, url?: string, profileDir?: string, headless?: boolean, channel?: string}} opts
 */
export async function openRoom(opts = {}) {
  const {
    roomId,
    url,
    profileDir = DEFAULT_PROFILE,
    headless = false,
    channel = 'msedge',
  } = opts;
  const target = url || (roomId ? `https://live.douyin.com/${encodeURIComponent(roomId)}` : null);
  if (!target) throw new Error('缺少直播间号（roomId）或完整地址（url）');

  const context = await chromium.launchPersistentContext(path.resolve(profileDir), {
    channel,
    headless,
    viewport: null,
    locale: 'zh-CN',
    args: [
      '--start-maximized',
      '--mute-audio',
      '--disable-blink-features=AutomationControlled',
      '--no-first-run',
      '--no-default-browser-check',
      '--no-restore-last-session',
      '--hide-crash-restore-bubble',
    ],
  });

  // Edge 会把上次异常退出时开着的标签页恢复出来（比如上一次测试的房间），
  // 于是会出现「一个自己设的房间 + 一个旧房间」两个窗口。
  // 这里只留一个页面，并把它导航到目标房间。
  const opened = context.pages();
  const page = opened[0] ?? (await context.newPage());
  for (const extra of opened.slice(1)) {
    await extra.close().catch(() => {});
  }
  page.setDefaultTimeout(30_000);
  page.on('dialog', (d) => d.dismiss().catch(() => {}));

  let navError = null;
  try {
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  } catch (error) {
    navError = error;
  }
  // 直播间是异步渲染的，等一下再注入
  await page.waitForTimeout(2_500);
  await page.evaluate(installCollector);
  // 注入时会把已在屏上的历史消息扫一遍；那批不是"新来的"，直接丢掉，
  // 否则一启动就会把几十条旧弹幕一次性灌给桌宠。
  await drain(page);
  return { context, page, target, navError };
}

/** 取回并清空页面侧队列 */
export async function drain(page) {
  try {
    return (await page.evaluate(() => (window.__dypet ? window.__dypet.drain() : []))) ?? [];
  } catch {
    return [];
  }
}

export async function diagnose(page) {
  try {
    return await page.evaluate(() => (window.__dypet ? window.__dypet.diagnose() : null));
  } catch (error) {
    return { error: String(error?.message ?? error) };
  }
}

export async function containerHtml(page, index = 0) {
  try {
    return await page.evaluate((i) => (window.__dypet ? window.__dypet.html(i) : null), index);
  } catch {
    return null;
  }
}

export async function waitForChat(page, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => (window.__dypet ? window.__dypet.diagnose() : null));
    if (info && (info.chatRoots > 0 || info.hits > 0)) return info;
    await page.waitForTimeout(500);
  }
  return diagnose(page);
}
