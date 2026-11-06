/**
 * 插件配置：默认值、读写、校验。
 * 存放位置：<DSH_HOME>/douyin-live-pet/config.json（默认 ~/.dsh/douyin-live-pet）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export const PLUGIN_ID = 'dsh-douyin-live-pet';

export const DEFAULTS = Object.freeze({
  roomId: '',
  autoStart: false,
  pet: { enabled: true, baseUrl: 'http://127.0.0.1:52718', petId: 'main', surface: 'desktop' },
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
  tts: {
    enabled: true,
    engine: 'edge', // edge | sapi | http | off
    voice: 'zh-CN-XiaoxiaoNeural',
    volume: 90,
    rate: '+8%',
    endpoint: '', // engine=http 时的外接语音服务地址
  },
  capture: { pollMs: 400, headless: false, channel: 'msedge', profileDir: '' },
  fallback: { narrate: true },
});

export const LIMITS = {
  minIntervalSec: [5, 600],
  maxPerMinute: [1, 60],
  giftCooldownSec: [0, 600],
  keywordCooldownSec: [0, 600],
  chatProbability: [0, 1],
  maxBatch: [1, 20],
  volume: [0, 100],
  pollMs: [150, 5000],
};

export function homeDir() {
  const base = process.env.DSH_HOME || path.join(os.homedir(), '.dsh');
  return path.join(base, 'douyin-live-pet');
}

export function configFile() {
  return path.join(homeDir(), 'config.json');
}

export function historyFile() {
  return path.join(homeDir(), 'history.jsonl');
}

/** 房间号或链接 → 纯房间号 */
export function normalizeRoom(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const byUrl = /live\.douyin\.com\/(\d{4,30})/i.exec(raw);
  if (byUrl) return byUrl[1];
  const digits = /^(\d{4,30})$/.exec(raw);
  return digits ? digits[1] : '';
}

function isObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

export function deepMerge(base, patch) {
  if (!isObject(patch)) return patch === undefined ? base : patch;
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = isObject(v) && isObject(base?.[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

function clampNumber(value, fallback, [min, max]) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * 把任意输入规整成合法配置。返回 { config, errors, changed }，
 * errors 非空时 config 里仍是「尽量修好」的值——设置页据此提示，不会写坏文件。
 */
export function normalizeConfig(input = {}) {
  const errors = [];
  const merged = deepMerge(DEFAULTS, input);
  const cfg = {
    roomId: normalizeRoom(merged.roomId),
    autoStart: Boolean(merged.autoStart),
    pet: {
      enabled: merged.pet?.enabled !== false,
      baseUrl: String(merged.pet?.baseUrl || DEFAULTS.pet.baseUrl).replace(/\/+$/, ''),
      petId: String(merged.pet?.petId || DEFAULTS.pet.petId).trim() || DEFAULTS.pet.petId,
      surface: ['web', 'desktop'].includes(merged.pet?.surface) ? merged.pet.surface : DEFAULTS.pet.surface,
    },
    reply: {
      minIntervalSec: clampNumber(merged.reply?.minIntervalSec, DEFAULTS.reply.minIntervalSec, LIMITS.minIntervalSec),
      maxPerMinute: Math.round(clampNumber(merged.reply?.maxPerMinute, DEFAULTS.reply.maxPerMinute, LIMITS.maxPerMinute)),
      giftCooldownSec: clampNumber(merged.reply?.giftCooldownSec, DEFAULTS.reply.giftCooldownSec, LIMITS.giftCooldownSec),
      keywordCooldownSec: clampNumber(
        merged.reply?.keywordCooldownSec,
        DEFAULTS.reply.keywordCooldownSec,
        LIMITS.keywordCooldownSec,
      ),
      chatProbability: clampNumber(merged.reply?.chatProbability, DEFAULTS.reply.chatProbability, LIMITS.chatProbability),
      keywords: Array.isArray(merged.reply?.keywords)
        ? [...new Set(merged.reply.keywords.map((k) => String(k).trim()).filter(Boolean))].slice(0, 20)
        : [...DEFAULTS.reply.keywords],
      ignoreGifts: Array.isArray(merged.reply?.ignoreGifts)
        ? merged.reply.ignoreGifts.map((k) => String(k).trim()).filter(Boolean).slice(0, 40)
        : [...DEFAULTS.reply.ignoreGifts],
      maxBatch: Math.round(clampNumber(merged.reply?.maxBatch, DEFAULTS.reply.maxBatch, LIMITS.maxBatch)),
      includeEnter: Boolean(merged.reply?.includeEnter),
      includeLike: Boolean(merged.reply?.includeLike),
    },
    tts: {
      enabled: merged.tts?.enabled !== false,
      engine: ['edge', 'sapi', 'http', 'off'].includes(merged.tts?.engine) ? merged.tts.engine : 'edge',
      voice: String(merged.tts?.voice || DEFAULTS.tts.voice),
      volume: Math.round(clampNumber(merged.tts?.volume, DEFAULTS.tts.volume, LIMITS.volume)),
      rate: String(merged.tts?.rate || DEFAULTS.tts.rate),
      endpoint: String(merged.tts?.endpoint || ''),
    },
    capture: {
      pollMs: Math.round(clampNumber(merged.capture?.pollMs, DEFAULTS.capture.pollMs, LIMITS.pollMs)),
      headless: Boolean(merged.capture?.headless),
      channel: String(merged.capture?.channel || 'msedge'),
      profileDir: String(merged.capture?.profileDir || ''),
    },
    fallback: { narrate: merged.fallback?.narrate !== false },
  };

  if (String(merged.roomId ?? '').trim() && !cfg.roomId) {
    errors.push('直播间填的不是房间号，也不是 live.douyin.com 的链接');
  }
  if (cfg.tts.engine === 'http' && !/^https?:\/\//i.test(cfg.tts.endpoint)) {
    errors.push('外接语音服务地址要以 http:// 或 https:// 开头');
  }
  if (!/^https?:\/\//i.test(cfg.pet.baseUrl)) {
    errors.push('桌宠地址要以 http:// 开头');
  }
  return { config: cfg, errors };
}

export function readConfig(file = configFile()) {
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') {
      // 文件坏了不致命：用默认值跑，并在设置页提示
      return { ...normalizeConfig({}).config, errors: [`配置文件解析失败：${error.message}`], file };
    }
  }
  const { config, errors } = normalizeConfig(raw);
  return { ...config, errors: [...errors], file };
}

/** 落盘（只写用户可编辑的字段，不写运行时空值） */
export function writeConfig(patch, file = configFile()) {
  const current = readConfig(file);
  const { errors: _ignored, file: _f, ...currentBody } = current;
  const merged = deepMerge(currentBody, patch ?? {});
  const { config, errors } = normalizeConfig(merged);
  if (errors.length) return { ok: false, errors, config };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
  return { ok: true, errors: [], config };
}

/** 给设置页看的配置：把内部路径换成可读值 */
export function publicConfig(cfg) {
  const { errors = [], file, ...rest } = cfg;
  return {
    ...rest,
    errors,
    file,
    resolvedProfileDir: cfg.capture.profileDir || path.join(homeDir(), 'browser-profile-anon'),
  };
}
