/**
 * 回话策略：纯逻辑，不碰网络和 DOM，方便单测。
 * 输入当前攒下的消息和运行时状态，输出「这次要不要回、为什么」。
 */

/**
 * @param {object} cfg reply 配置
 */
export function createReplyPolicy(cfg) {
  return {
    /**
     * @param {Array<{kind:string,user:string|null,text:string}>} pending
     * @param {{lastReplyAt:number,lastGiftAt:number,lastKeywordAt:number,replies:number[],fresh:number}} state
     * @param {number} now
     * @param {() => number} [random]
     * @returns {{reason:'gift'|'keyword'|'chat', batch: Array<any>} | null}
     */
    decide(pending, state, now, random = Math.random) {
      if (!pending.length) return null;
      if (!state.fresh) return null;

      const recent = (state.replies ?? []).filter((t) => now - t < 60_000);
      if (recent.length >= cfg.maxPerMinute) return null;
      if (now - state.lastReplyAt < cfg.minIntervalSec * 1000) return null;

      const gifts = pending.filter((m) => m.kind === 'gift');
      if (gifts.length && now - state.lastGiftAt >= cfg.giftCooldownSec * 1000) {
        return { reason: 'gift', batch: pending.slice(-cfg.maxBatch) };
      }

      const hit = pending.find(
        (m) => m.kind === 'chat' && cfg.keywords.some((k) => `${m.user ?? ''}${m.text}`.includes(k)),
      );
      if (hit && now - state.lastKeywordAt >= cfg.keywordCooldownSec * 1000) {
        return { reason: 'keyword', batch: pending.slice(-cfg.maxBatch) };
      }

      if (random() < cfg.chatProbability) {
        return { reason: 'chat', batch: pending.slice(-cfg.maxBatch) };
      }
      return null;
    },
  };
}
