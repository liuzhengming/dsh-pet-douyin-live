/**
 * 直播引擎：开浏览器 → 采弹幕 → 攒批 → 回话 → 朗读 → 记历史。
 * 插件（设置页点开始）和命令行（npm start）共用这一份，避免两套逻辑走偏。
 */
import path from 'node:path';
import { drain, openRoom, waitForChat } from './capture.mjs';
import { homeDir } from './config.mjs';
import { buildPrompt, createDeduper, parseRecord } from './parser.mjs';
import { createReplyPolicy } from './policy.mjs';
import { checkPet, generateReply } from './reply.mjs';
import { speak } from './tts.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REASON_LABEL = { gift: '礼物', keyword: '叫到名字', chat: '接一句' };

/** 只收像观众消息的记录；页面上的价目表、榜单、私信浮窗都要挡掉 */
function looksLikeMessage(parsed, record, replyCfg) {
  const cls = String(record?.cls ?? '');
  if (/conversation|ConversationList|im-dialog|private-message/i.test(cls)) return false;
  if (parsed.kind === 'gift') {
    const name = String(parsed.gift ?? parsed.raw);
    return !(replyCfg.ignoreGifts ?? []).some((n) => name.includes(n));
  }
  if (parsed.kind === 'enter') return Boolean(replyCfg.includeEnter) && record?.inChat === true;
  if (parsed.kind === 'like') return Boolean(replyCfg.includeLike) && record?.inChat === true;
  return record?.inChat === true;
}

export class LiveEngine {
  #config;
  #history;
  #log;
  #dry;
  #context = null;
  #page = null;
  #stopping = false;
  #loopPromise = null;
  #state = {
    running: false,
    roomId: '',
    startedAt: 0,
    messages: 0,
    replies: 0,
    lastError: null,
    lastMessageAt: 0,
    petOnline: false,
  };

  constructor({ config, history, log = () => {}, dry = false }) {
    this.#config = config;
    this.#history = history;
    this.#log = log;
    this.#dry = dry;
  }

  status() {
    return { ...this.#state, running: this.#state.running };
  }

  /** 运行时改配置（设置页保存后调用）；正在跑的话下一轮循环自然生效 */
  updateConfig(config) {
    this.#config = config;
  }

  profileDir() {
    const configured = this.#config.capture?.profileDir;
    return configured ? path.resolve(configured) : path.join(homeDir(), 'browser-profile-anon');
  }

  async start(roomId) {
    if (this.#state.running) return this.status();
    const room = String(roomId ?? '').trim();
    if (!room) throw new Error('没有房间号');

    this.#stopping = false;
    this.#state = {
      running: true,
      roomId: room,
      startedAt: Date.now(),
      messages: 0,
      replies: 0,
      lastError: null,
      lastMessageAt: 0,
      petOnline: false,
    };

    const opened = await openRoom({
      roomId: room,
      profileDir: this.profileDir(),
      headless: this.#config.capture.headless,
      channel: this.#config.capture.channel,
    }).catch((error) => {
      this.#state.running = false;
      this.#state.lastError = String(error?.message ?? error);
      throw error;
    });

    this.#context = opened.context;
    this.#page = opened.page;
    if (opened.navError) this.#log(`页面加载告警：${opened.navError.message}`);

    const info = await waitForChat(this.#page, 25_000);
    if (!info?.chatRoots && !info?.hits) this.#log('没识别到聊天区，可能房间未开播或页面改版');
    this.#log(`开播监听：房间 ${room}，聊天容器 ${info?.chatRoots ?? 0} 个`);

    const pet = await checkPet(this.#config.pet);
    this.#state.petOnline = pet.online;
    this.#log(pet.online ? '桌宠在线，回话交给桌宠' : `桌宠不可用（${pet.reason}），降级为播报`);

    this.#loopPromise = this.#loop();
    return this.status();
  }

  async stop(reason = 'manual') {
    if (!this.#state.running) return this.status();
    this.#stopping = true;
    this.#state.running = false;
    this.#log(`停止监听（${reason}）`);
    await this.#loopPromise?.catch(() => {});
    this.#loopPromise = null;
    const context = this.#context;
    this.#context = null;
    this.#page = null;
    await context?.close().catch(() => {});
    return this.status();
  }

  async #loop() {
    const cfg = this.#config;
    const isDup = createDeduper({ windowMs: 60_000 });
    const policy = createReplyPolicy(cfg.reply);
    const pending = [];
    const state = { lastReplyAt: 0, lastGiftAt: 0, lastKeywordAt: 0, replies: [], fresh: 0 };
    const pollMs = cfg.capture.pollMs;

    while (!this.#stopping) {
      let raw = [];
      try {
        raw = await drain(this.#page);
      } catch (error) {
        this.#state.lastError = String(error?.message ?? error);
        this.#log('页面读不到了，停止监听');
        break;
      }

      for (const rec of raw) {
        const parsed = parseRecord(rec);
        if (!parsed) continue;
        if (!looksLikeMessage(parsed, rec, cfg.reply)) continue;
        if (isDup(parsed.raw)) continue;
        pending.push(parsed);
        state.fresh += 1;
        this.#state.messages += 1;
        this.#state.lastMessageAt = Date.now();
        this.#log(`[${parsed.kind}] ${parsed.user ? `${parsed.user}｜` : ''}${parsed.text}`);
      }
      if (pending.length > 80) pending.splice(0, pending.length - 80);

      const now = Date.now();
      state.replies = state.replies.filter((t) => now - t < 60_000);

      const decision = policy.decide(pending, state, now);
      if (decision) {
        await this.#handleReply(decision, pending, state);
        pending.length = 0;
        state.fresh = 0;
      }
      await sleep(pollMs);
    }

    this.#state.running = false;
  }

  async #handleReply(decision, pending, state) {
    const cfg = this.#config;
    const prompt = buildPrompt(decision.batch, { maxItems: cfg.reply.maxBatch });
    const label = REASON_LABEL[decision.reason] ?? decision.reason;
    this.#log(`→ 回话（${label}，攒了 ${decision.batch.length} 条）`);

    if (this.#dry) {
      this.#log(`[dry] 会发给桌宠：\n${prompt}`);
      state.lastReplyAt = Date.now();
      if (decision.reason === 'gift') state.lastGiftAt = Date.now();
      if (decision.reason === 'keyword') state.lastKeywordAt = Date.now();
      return;
    }

    let result = { text: null, source: 'none' };
    try {
      result = await generateReply({ cfg, batch: decision.batch, prompt, log: this.#log });
    } catch (error) {
      this.#log(`回话失败：${error?.message ?? error}`);
    }

    // 不论成功与否，冷却都要走，否则桌宠抖动会变成每 400ms 打一次
    state.lastReplyAt = Date.now();
    if (decision.reason === 'gift') state.lastGiftAt = Date.now();
    if (decision.reason === 'keyword') state.lastKeywordAt = Date.now();

    if (result.text) {
      state.replies.push(Date.now());
      this.#state.replies += 1;
      this.#log(result.source === 'pet' ? `桌宠回话：${result.text}` : `播报：${result.text}`);
      if (cfg.tts.enabled && cfg.tts.engine !== 'off') {
        const spoken = await speak(result.text, cfg.tts);
        if (!spoken.ok) this.#log(`朗读失败（${spoken.engine ?? 'tts'}）：${spoken.error ?? ''}`);
      }
    }

    const latest = decision.batch[decision.batch.length - 1] ?? pending[pending.length - 1];
    this.#history?.append({
      kind: latest?.kind ?? 'chat',
      user: latest?.user ?? null,
      text: latest?.text ?? '',
      reply: result.text,
      reason: decision.reason,
      ok: Boolean(result.text),
    });
  }
}
