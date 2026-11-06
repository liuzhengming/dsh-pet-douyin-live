/**
 * 弹幕文本解析：纯函数，不碰 DOM、不碰网络，方便单测。
 *
 * 抖音直播网页里一行消息的形态大致是：
 *   「昵称：内容」       普通弹幕
 *   「昵称 送出了 小心心 ×3」 礼物
 *   「昵称 来了」          进场
 *   「昵称 为主播点赞了」   点赞
 * 但页面结构随时会变，所以这里只按**文本特征**判断，拿不到就降级成原始文本，
 * 绝不因为解析不了就丢消息。
 */

const GIFT_SEND = /送出|赠送|打赏|刷了/;
const GIFT_COUNT = /[×xX*]\s*(\d{1,4})/;
const ENTER = /(来了|进入直播间|加入直播间|加入了直播间|进入了直播间)\s*$/;
const LIKE = /(点亮了?|为主播点赞|点了赞)/;
/** 纯 UI 词汇，长度很短时基本不是观众发言 */
const UI_NOISE =
  /^(关注|分享|举报|更多|设置|登录|充值|排行榜|观众|在线|说点什么|发送|礼物|聊天|互动|收起|展开|小时榜|人气榜|贡献榜|在线观众|高等级用户|暂无在线观众)$/;

/** 这些是页面固定文案/面板价目，不是观众消息 */
const NOISE_PATTERNS = [
  /^\d+钻\s/, // 礼物价目表：99钻 Thuglife 99钻
  /^\d+\s+\S/, // 榜单序号：1 聪哥｜巨航
  /^(全部|暂无|需先登录|已退出|账号已在)/,
  /聊天功能不可用|无法评论|其他地方进入直播间|继续看播/,
  /^(标清|高清|超清|蓝光|原画|自动)$/,
  /^(本场点赞|\d+(\.\d+)?万本场点赞)/,
  /恭喜.*(升级|达成)|刚刚升级至/,
  /^欢迎来到直播间/, // 平台合规提示
  /原画可试看|登录可无限|畅享原画/, // 画质推广
  /本场点赞/, // 主播热度条
  /^\d+\+$/, // 榜单数值
  /^-\s+\S/, // 观众榜条目：- 昵称
  /推荐了直播$/, // 系统推荐提示
];

export function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u200b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 只做分类，不改写文本 */
export function classify(text) {
  const t = normalizeText(text);
  if (!t) return 'empty';
  // 礼物必须同时有「送出语义」和「数量」或「礼物字样」，避免把聊天里的「送你」误判
  if (GIFT_SEND.test(t) || (GIFT_COUNT.test(t) && /礼|🎁|❤|🌸/.test(t))) return 'gift';
  if (ENTER.test(t)) return 'enter';
  if (LIKE.test(t)) return 'like';
  return 'chat';
}

/**
 * 把页面采到的一条原始记录解析成结构化消息。
 * @param {{text?: string, ts?: number, cls?: string}} record
 * @returns {{kind: string, user: string|null, text: string, raw: string, gift: string|null, count: number|null, ts: number}|null}
 */
export function parseRecord(record) {
  const raw = normalizeText(record?.text);
  if (!raw) return null;
  if (UI_NOISE.test(raw)) return null;
  if (NOISE_PATTERNS.some((re) => re.test(raw))) return null;

  const kind = classify(raw);
  let user = null;
  let text = raw;
  let gift = null;
  let count = null;

  if (kind === 'gift') {
    const cm = GIFT_COUNT.exec(raw);
    count = cm ? Number(cm[1]) : 1;
    gift = /(?:送出了?|赠送了?|打赏了?|刷了)\s*([^×xX*]{1,24})/.exec(raw)?.[1]?.trim() ?? null;
    user = /^(.{1,24}?)\s*(?:送出了?|赠送了?|打赏了?|刷了)/.exec(raw)?.[1]?.trim() ?? null;
    text = gift ? `送出 ${gift}${count > 1 ? ` ×${count}` : ''}` : raw;
  } else if (kind === 'enter') {
    user = /^(.{1,24}?)\s*(?:来了|进入直播间|加入直播间)/.exec(raw)?.[1]?.trim() ?? null;
    text = '进入直播间';
  } else if (kind === 'like') {
    user = /^(.{1,24}?)\s*(?:点亮了?|为主播点赞|点了赞)/.exec(raw)?.[1]?.trim() ?? null;
    text = '给主播点了赞';
  } else {
    const m = /^([^：:]{1,24})[：:]\s*(.+)$/.exec(raw);
    if (m) {
      user = m[1].trim();
      text = m[2].trim();
    }
  }

  if (user) user = user.replace(/^[\s「」【】@]+/, '').replace(/[\s「」【】@：:]+$/, '');
  const content = String(text ?? '').trim();
  // 只有昵称没有内容的空评论，别拿去问桌宠
  if (!content) return null;
  if (kind === 'chat' && /[：:]\s*$/.test(raw)) return null;
  // 「1」「。」这种单字刷屏对桌宠没有信息量
  if (kind === 'chat' && content.length < 2) return null;
  return { kind, user, text: content, raw, gift, count, ts: Number(record?.ts) || Date.now() };
}

/**
 * 文本去重：同一个文本在窗口期内只算一次。
 * 抖音的弹幕行会同时以「整行新增」和「行内文本节点新增」两种形态出现，必须去重。
 */
export function createDeduper({ windowMs = 60_000, max = 2000 } = {}) {
  const seen = new Map();
  return function isDuplicate(key) {
    const now = Date.now();
    const prev = seen.get(key);
    if (prev !== undefined && now - prev < windowMs) return true;
    seen.set(key, now);
    if (seen.size > max) {
      for (const [k, ts] of seen) {
        if (now - ts >= windowMs) seen.delete(k);
        else break;
      }
      // 极端情况下仍然超限：直接丢掉最早的一半
      if (seen.size > max) {
        const keys = [...seen.keys()].slice(0, Math.floor(seen.size / 2));
        for (const k of keys) seen.delete(k);
      }
    }
    return false;
  };
}

/** 拼给桌宠的提示词：把一批观众消息压成一小段，让它挑着回 */
export function buildPrompt(messages, { maxItems = 6 } = {}) {
  const picked = messages.slice(-maxItems);
  if (!picked.length) return null;
  const lines = picked.map((m) => {
    if (m.kind === 'gift') {
      const who = m.user || '有人';
      return `礼物：${who} ${m.text}`;
    }
    if (m.kind === 'enter') return `进场：${m.user || '有人'}来了`;
    if (m.kind === 'like') return `点赞：${m.user || '有人'}点了赞`;
    return `弹幕：${m.user ? `${m.user}：` : ''}${m.text}`;
  });
  return [
    '这是你正在看的抖音直播间的观众消息：',
    ...lines.map((l) => `- ${l}`),
    '',
    '用你平时说话的口吻，挑其中一两条回应一句，20 字以内，不要旁白、不要解释、不要带引号。',
  ].join('\n');
}
