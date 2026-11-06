/**
 * 主循环：直播间文本 → 过滤/去重 → 攒批 → 交给 dsh-pet 回话 → 朗读。
 *
 * 用法：
 *   node src/bridge.mjs --room 123456789        正常跑
 *   node src/bridge.mjs --room 123456789 --dry  只打印，不调桌宠也不出声
 *   node src/bridge.mjs --selftest              只测桌宠和 TTS，不碰浏览器
 *   node src/bridge.mjs --say "在吗"             单独试一句
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drain, openRoom, waitForChat } from './capture.mjs';
import { buildPrompt, createDeduper, parseRecord } from './parser.mjs';
import { createReplyPolicy } from './policy.mjs';
import { petChat, petState } from './pet.mjs';
import { speak } from './tts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

const DEFAULTS = {
  roomId: '',
  pet: { baseUrl: 'http://127.0.0.1:52718', petId: 'main', surface: 'desktop' },
  reply: {
    minIntervalSec: 20,
    maxPerMinute: 3,
    giftCooldownSec: 45,
    keywordCooldownSec: 10,
    chatProbability: 0.35,
    keywords: ['鱼', '小女仆', '主播'],
    ignoreGifts: ['小心心', '粉丝团灯牌', '人气票', '加油鸭', '棒棒糖'],
    maxBatch: 6,
    includeEnter: false,
    includeLike: false,
  },
  tts: { enabled: true, engine: 'edge', voice: 'zh-CN-XiaoxiaoNeural', volume: 90, rate: '+8%' },
  capture: { pollMs: 400, headless: false, channel: 'msedge', profileDir: 'browser-profile-anon' },
};

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function deepMerge(base, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return patch === undefined ? base : patch;
  const result = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    result[k] = v && typeof v === 'object' && !Array.isArray(v) ? deepMerge(base?.[k] ?? {}, v) : v;
  }
  return result;
}

function loadConfig(file) {
  const target = path.resolve(ROOT, file ?? 'config.json');
  let user = {};
  try {
    user = JSON.parse(fs.readFileSync(target, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`配置文件读不动：${target}\n${error.message}`);
  }
  return deepMerge(DEFAULTS, user);
}

function createLogger() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `bridge-${new Date().toISOString().slice(0, 10)}.log`);
  return (line) => {
    const stamp = new Date().toISOString().slice(11, 19);
    const text = `[${stamp}] ${line}`;
    console.log(text);
    try {
      fs.appendFileSync(file, `${text}\n`, 'utf8');
    } catch {
      /* 日志写不进去不影响主流程 */
    }
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 只收「像观众消息」的记录。
 * 页面上同时飘着画质切换、礼物价目表、榜单、私信浮窗的文案，
 * 全靠解析层过滤不够——这里再用所在区域的 class 兜一道。
 */
function looksLikeMessage(parsed, record, cfg) {
  const cls = String(record?.cls ?? '');
  if (/conversation|ConversationList|im-dialog|private-message/i.test(cls)) return false;
  if (parsed.kind === 'gift') {
    const name = String(parsed.gift ?? parsed.raw);
    const ignored = (cfg.reply.ignoreGifts ?? []).some((n) => name.includes(n));
    return !ignored; // 1 钻的小心心每几秒就一个，全谢一遍会变成复读机
  }
  if (parsed.kind === 'enter') return Boolean(cfg.reply.includeEnter) && record?.inChat === true;
  if (parsed.kind === 'like') return Boolean(cfg.reply.includeLike) && record?.inChat === true;
  return record?.inChat === true;
}

function petIdLabel(cfg) {
  return `${cfg.pet.petId}@${cfg.pet.surface}`;
}

async function replyWithPet(batch, cfg, log, { dry = false } = {}) {
  const prompt = buildPrompt(batch, { maxItems: cfg.reply.maxBatch });
  if (!prompt) return null;
  if (dry) {
    log(`[dry] 会发给桌宠：\n${prompt}`);
    return null;
  }
  const started = Date.now();
  const result = await petChat({ ...cfg.pet, text: prompt });
  if (!result.ok) {
    log(`桌宠没回话（${result.reason}）：${result.message ?? ''}`);
    return null;
  }
  log(`桌宠回话（${Date.now() - started}ms）：${result.text}`);
  return result.text;
}

async function speakReply(text, cfg, log) {
  if (!text) return;
  const r = await speak(text, cfg.tts);
  if (!r.ok) log(`朗读失败（${r.engine ?? 'tts'}）：${r.error ?? '未知原因'}`);
}

async function runBridge(args, cfg) {
  const log = createLogger();
  const roomId = args.room ?? cfg.roomId;
  const dry = Boolean(args.dry);
  if (!roomId) throw new Error('没给直播间号：--room <房间号>，或写进 config.json 的 roomId');

  log(`启动：房间 ${roomId}，桌宠 ${petIdLabel(cfg)}，TTS ${cfg.tts.enabled ? cfg.tts.engine : '关'}${dry ? '，dry 模式' : ''}`);

  if (!dry) {
    const state = await petState(cfg.pet.baseUrl);
    if (!state.ok) log(`警告：桌宠端点不可用（${state.message ?? state.status}），回话会失败`);
  }

  const { context, page, navError } = await openRoom({
    roomId,
    profileDir: path.resolve(ROOT, args.profile ?? cfg.capture.profileDir),
    headless: cfg.capture.headless,
    channel: cfg.capture.channel,
  });
  if (navError) log(`页面加载告警：${navError.message}`);

  const info = await waitForChat(page, 25_000);
  if (!info?.chatRoots && !info?.hits) log('没识别到聊天区，先跑 npm run inspect 校准一下。');
  else log(`聊天区已就绪：候选容器 ${info?.chatRoots ?? 0} 个`);

  const isDup = createDeduper({ windowMs: 60_000 });
  const pending = [];
  const policy = createReplyPolicy(cfg.reply);
  const state = { lastReplyAt: 0, lastGiftAt: 0, lastKeywordAt: 0, replies: [], fresh: 0 };
  const pollMs = Math.max(150, Number(cfg.capture.pollMs) || 400);
  const deadline = args.seconds ? Date.now() + Number(args.seconds) * 1000 : Infinity;
  let stopping = false;

  const stop = async () => {
    if (stopping) return;
    stopping = true;
    log('停止：关闭浏览器');
    await context.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  while (!stopping) {
    if (Date.now() > deadline) {
      log(`到达 --seconds 上限，收工`);
      break;
    }
    const raw = await drain(page);
    for (const rec of raw) {
      const parsed = parseRecord(rec);
      if (!parsed) continue;
      if (!looksLikeMessage(parsed, rec, cfg)) continue;
      if (isDup(parsed.raw)) continue;
      pending.push(parsed);
      state.fresh += 1;
      const who = parsed.user ? `${parsed.user}｜` : '';
      log(`[${parsed.kind}] ${who}${parsed.text}`);
    }
    if (pending.length > 80) pending.splice(0, pending.length - 80);

    const now = Date.now();
    state.replies = state.replies.filter((t) => now - t < 60_000);

    const decision = policy.decide(pending, state, now);
    if (decision) {
      const label = { gift: '礼物', keyword: '叫到名字', chat: '随便接一句' }[decision.reason];
      log(`→ 回话（${label}，攒了 ${decision.batch.length} 条）`);
      const text = await replyWithPet(decision.batch, cfg, log, { dry });
      // 不管这次有没有真回上，冷却都要走——否则 dry 模式或桌宠抖动会变成每 400ms 打一次
      state.lastReplyAt = Date.now();
      if (decision.reason === 'gift') state.lastGiftAt = Date.now();
      if (decision.reason === 'keyword') state.lastKeywordAt = Date.now();
      if (text) {
        state.replies.push(Date.now());
        await speakReply(text, cfg, log);
      }
      pending.length = 0;
      state.fresh = 0;
    }
    await sleep(pollMs);
  }

  await context.close().catch(() => {});
}

async function selftest(args, cfg) {
  const log = createLogger();
  log('自检开始');
  const state = await petState(cfg.pet.baseUrl);
  log(`桌宠端点：${state.ok ? '在线' : `不可用（${state.message ?? state.status}）`}`);
  const text = '自检：能听见我说话吗？';
  const result = await petChat({ ...cfg.pet, text });
  if (!result.ok) {
    log(`桌宠回话失败：${result.reason} ${result.message ?? ''}`);
    return;
  }
  log(`桌宠回话：${result.text}`);
  const spoken = await speak(result.text, cfg.tts);
  log(`朗读：${spoken.ok ? '成功' : `失败（${spoken.error ?? ''}）`}`);
}

async function say(args, cfg) {
  const log = createLogger();
  const text = args._.join(' ').trim() || '这是一句测试语音。';
  const result = await petChat({ ...cfg.pet, text });
  if (!result.ok) {
    log(`桌宠回话失败：${result.reason} ${result.message ?? ''}`);
    return;
  }
  log(`桌宠：${result.text}`);
  const spoken = await speak(result.text, cfg.tts);
  log(`朗读：${spoken.ok ? '成功' : `失败（${spoken.error ?? ''}）`}`);
}

const args = parseArgs(process.argv.slice(2));
const cfg = loadConfig(args.config);
try {
  if (args.selftest) await selftest(args, cfg);
  else if (args.say) await say(args, cfg);
  else await runBridge(args, cfg);
} catch (error) {
  console.error(`出错了：${error?.message ?? error}`);
  process.exit(1);
}
