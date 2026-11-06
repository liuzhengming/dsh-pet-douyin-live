/**
 * 采集器集成测试：不碰抖音，用本地假页面验证「注入 → 监听新增节点 → drain」这条链路。
 * 这样即使直播间进不去（没登录），DOM 采集逻辑本身也是被验证过的。
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { installCollector } from '../src/inpage.mjs';
import { parseRecord } from '../src/parser.mjs';

const PAGE = `<!doctype html><html><body>
  <div id="player">video area</div>
  <div class="webcast-chatroom___items" style="width:320px;height:420px;overflow:hidden">
    <div class="webcast-chatroom___item">主持人：欢迎来到直播间</div>
  </div>
</body></html>`;

async function withPage(fn) {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    await page.setContent(PAGE);
    await page.evaluate(installCollector);
    await fn(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

test('采集器：识别聊天容器', async () => {
  await withPage(async (page) => {
    const info = await page.evaluate(() => window.__dypet.diagnose());
    assert.equal(info.chatRoots, 1);
    assert.equal(info.loginWall, false);
    assert.ok(Array.isArray(info.candidates));
  });
});

test('采集器：新增弹幕被记录，且带 inChat 标记', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      const list = document.querySelector('.webcast-chatroom___items');
      for (const text of ['小明：主播好', '小红 送出了 小心心 ×3', '路人甲 来了']) {
        const row = document.createElement('div');
        row.className = 'webcast-chatroom___item';
        row.textContent = text;
        list.append(row);
      }
    });
    await page.waitForTimeout(300);
    const records = await page.evaluate(() => window.__dypet.drain());
    const texts = records.map((r) => r.text);
    assert.ok(texts.some((t) => t.includes('小明')), `没采到弹幕：${JSON.stringify(texts)}`);
    assert.ok(records.some((r) => r.inChat === true), '应至少有记录被标成聊天区内');
  });
});

test('采集器：drain 之后队列清空，不重复消费', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'webcast-chatroom___item';
      row.textContent = '阿强：哈哈';
      document.querySelector('.webcast-chatroom___items').append(row);
    });
    await page.waitForTimeout(300);
    const first = await page.evaluate(() => window.__dypet.drain());
    const second = await page.evaluate(() => window.__dypet.drain());
    assert.ok(first.some((r) => r.text.includes('阿强')));
    assert.equal(second.length, 0);
  });
});

test('采集器：同一条文本在短时间内只记一次', async () => {
  await withPage(async (page) => {
    await page.evaluate(() => {
      const list = document.querySelector('.webcast-chatroom___items');
      for (let i = 0; i < 3; i += 1) {
        const row = document.createElement('div');
        row.className = 'webcast-chatroom___item';
        row.textContent = '重复的一句话';
        list.append(row);
      }
    });
    await page.waitForTimeout(300);
    const records = await page.evaluate(() => window.__dypet.drain());
    assert.equal(records.filter((r) => r.text === '重复的一句话').length, 1);
  });
});

test('采集器：选择器不命中时按高频父容器自动认聊天区', async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 700 } });
    // 故意用抖音改版后的哈希 class，让所有选择器都打不中
    await page.setContent('<div id="list" class="YVzXjZcQ" style="width:340px;height:420px"></div>');
    await page.evaluate(installCollector);
    await page.evaluate(() => {
      const list = document.getElementById('list');
      for (let i = 0; i < 5; i += 1) {
        const row = document.createElement('div');
        row.textContent = `观众${i}：你好呀`;
        list.append(row);
      }
    });
    await page.waitForTimeout(300);
    const info = await page.evaluate(() => {
      window.__dypet.drain();
      return window.__dypet.diagnose();
    });
    assert.equal(info.chatRoots, 1, '应自动认出聊天区');
    assert.equal(info.rootSource, 'auto');
  } finally {
    await browser.close().catch(() => {});
  }
});

test('端到端：采集到的文本能被解析成弹幕', async () => {  await withPage(async (page) => {
    await page.evaluate(() => {
      const row = document.createElement('div');
      row.className = 'webcast-chatroom___item';
      row.textContent = '土豪哥 送出了 嘉年华 ×2';
      document.querySelector('.webcast-chatroom___items').append(row);
    });
    await page.waitForTimeout(300);
    const records = await page.evaluate(() => window.__dypet.drain());
    const hit = records.map(parseRecord).find((m) => m?.kind === 'gift');
    assert.ok(hit, '礼物没解析出来');
    assert.equal(hit.user, '土豪哥');
    assert.equal(hit.gift, '嘉年华');
    assert.equal(hit.count, 2);
  });
});
