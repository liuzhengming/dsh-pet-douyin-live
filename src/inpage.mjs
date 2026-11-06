/**
 * 注入到直播页里的采集器。
 *
 * 约束：这个函数会被 Playwright 序列化后丢进页面执行，**不能引用模块作用域**，
 * 所有东西都得写在函数体里。
 *
 * 做法是最保守的那种：监听整个 body 的新增节点，把「短文本节点」全部记录下来，
 * 带上它自己的 class 链，交给 Node 侧分类。这样即使抖音改了 class 名，
 * 只要弹幕还是以文本形式插进 DOM，就还能采到；采不准时用 inspect 模式校准。
 */

export function installCollector() {
  if (window.__dypet && window.__dypet.version >= 1) {
    return { installed: false, version: window.__dypet.version };
  }

  const SELECTORS = [
    '[class*="chatroom" i]',
    '[class*="chat-room" i]',
    '[class*="webcast-chat" i]',
    '[class*="ChatRoom" i]',
    '[data-e2e*="chat" i]',
  ];

  const state = {
    version: 1,
    queue: [],
    seen: new Map(),
    hits: 0,
    startedAt: Date.now(),
  };

  function visible(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05;
  }

  function classChain(el) {
    const parts = [];
    let node = el;
    for (let i = 0; i < 3 && node && node.nodeType === 1; i += 1) {
      const raw = typeof node.className === 'string' ? node.className : '';
      const names = raw.split(/\s+/).filter(Boolean).slice(0, 4);
      if (names.length) parts.push(names.join('.'));
      node = node.parentElement;
    }
    return parts.join(' < ').slice(0, 180);
  }

  function containers() {
    const found = [];
    for (const sel of SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (!visible(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 150 || r.height < 100) continue;
        found.push(el);
      }
    }
    const uniq = [...new Set(found)];
    // 只留最外层：被别的候选包住的不要，避免同一条消息记两次
    return uniq.filter((el) => !uniq.some((other) => other !== el && other.contains(el)));
  }

  let chatRoots = containers();
  let lastRootScan = 0;
  /** 元素 → 新增短文本次数；选择器全没命中时用它自动认出聊天区 */
  const tally = new Map();

  function bump(el) {
    let node = el;
    for (let i = 0; i < 4 && node && node.nodeType === 1; i += 1) {
      tally.set(node, (tally.get(node) || 0) + 1);
      node = node.parentElement;
    }
    if (tally.size > 400) tally.clear();
  }

  function autoRoot() {
    let best = null;
    let bestHits = 0;
    for (const [el, hits] of tally) {
      if (!el.isConnected || !visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 150 || r.height < 120) continue;
      if (hits > bestHits) {
        bestHits = hits;
        best = el;
      }
    }
    if (best && bestHits >= 3) {
      chatRoots = [best];
      rootSource = 'auto';
      return true;
    }
    return false;
  }
  let rootSource = 'selector';

  function inChat(el) {
    if (!chatRoots.length) return null;
    return chatRoots.some((root) => root.contains(el));
  }

  function push(text, el) {
    const t = String(text || '')
      .replace(/\u200b/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!t || t.length > 200) return;
    const now = Date.now();
    // 聊天面板常常比页面晚几秒才挂上来，这里每 2 秒重找一次，别让先到的消息全标成「不在聊天区」
    if (!chatRoots.length && now - lastRootScan > 2000) {
      lastRootScan = now;
      chatRoots = containers();
      if (!chatRoots.length) autoRoot();
    }
    const last = state.seen.get(t);
    if (last !== undefined && now - last < 45000) return;
    state.seen.set(t, now);
    if (state.seen.size > 4000) state.seen.clear();
    const chain = classChain(el);
    // 容器判定 + class 信号取并集：聊天面板晚到时 class 依然可靠
    const chatSignal = /chatroom|GiftTray|danmaku/i.test(chain);
    state.queue.push({ text: t, cls: chain, inChat: inChat(el) === true || chatSignal, ts: now });
    state.hits += 1;
    bump(el);
    if (state.queue.length > 800) state.queue.splice(0, state.queue.length - 800);
  }

  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (!node || node.nodeType !== 1) continue;
        const tag = node.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'LINK' || tag === 'SVG' || tag === 'PATH') continue;
        // 便宜的预筛：整串太长直接跳，避免对每个节点都算 innerText
        const cheap = node.textContent || '';
        if (!cheap || cheap.length > 200) continue;
        push(node.innerText ?? cheap, node);
      }
    }
  });

  function start() {
    if (!document.body) return false;
    chatRoots = containers();
    observer.observe(document.body, { childList: true, subtree: true });
    // 首屏已有的消息也扫一遍（只取每个容器最后几条）
    for (const root of chatRoots.slice(0, 4)) {
      const kids = [...root.querySelectorAll('*')].slice(-40);
      for (const el of kids) {
        const t = (el.textContent || '').trim();
        if (t && t.length <= 200) push(el.innerText ?? t, el);
      }
    }
    return true;
  }

  state.drain = () => {
    if (!chatRoots.length) autoRoot();
    const out = state.queue.slice();
    state.queue.length = 0;
    return out;
  };

  state.diagnose = () => {
    chatRoots = containers();
    if (!chatRoots.length) autoRoot();
    const bodyText = (document.body?.innerText || '').slice(0, 3000);
    return {
      url: location.href,
      title: document.title,
      chatRoots: chatRoots.length,
      rootSource,
      loginWall: /扫码登录|登录后|请登录|验证码|安全验证/.test(bodyText),
      chatDisabled: /聊天功能不可用/.test(bodyText),
      liveEnded: /直播已结束|主播已离开|暂时离开/.test(bodyText),
      hits: state.hits,
      queued: state.queue.length,
      candidates: chatRoots.slice(0, 6).map((el) => {
        const r = el.getBoundingClientRect();
        const kids = [...el.children].slice(-3);
        return {
          cls: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
          box: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
          rows: el.childElementCount,
          sample: kids.map((k) => (k.innerText || '').trim().slice(0, 80)),
        };
      }),
      recent: state.queue.slice(-12),
    };
  };

  state.html = (index = 0) => {
    chatRoots = containers();
    const root = chatRoots[index] ?? chatRoots[0];
    if (!root) return null;
    return root.outerHTML.slice(0, 4000);
  };

  state.stop = () => {
    observer.disconnect();
    state.queue.length = 0;
  };

  window.__dypet = state;
  const started = start();
  return { installed: true, version: state.version, started, chatRoots: chatRoots.length };
}
