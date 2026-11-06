/**
 * 回话来源：优先交给 dsh-pet（人格/记忆都在它那儿），
 * 桌宠没装或没开时降级成「播报」——只谢礼物、只回应被叫到，不假装聊天。
 */
import { petChat } from './pet.mjs';

/** 桌宠是否在线；失败不抛错，交给上层决定怎么提示 */
export async function checkPet(pet, { timeoutMs = 4000 } = {}) {
  if (!pet?.enabled) return { online: false, reason: 'disabled' };
  try {
    const url = new URL('/dsh-pet-7340/state', pet.baseUrl);
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { online: false, reason: `HTTP ${res.status}` };
    await res.json().catch(() => null);
    return { online: true };
  } catch (error) {
    return { online: false, reason: String(error?.message ?? error).slice(0, 120) };
  }
}

function templateFor(batch) {
  const gifts = batch.filter((m) => m.kind === 'gift');
  if (gifts.length) {
    const g = gifts[gifts.length - 1];
    const who = g.user || '有人';
    const name = g.gift || '礼物';
    const times = g.count && g.count > 1 ? ` ${g.count} 个` : '';
    return `谢谢${who}送的${name}${times}～`;
  }
  const named = batch.find((m) => m.kind === 'chat' && m.user);
  if (named) return `${named.user}，我在听呢～`;
  return null;
}

/**
 * @returns {Promise<{text: string|null, source: 'pet'|'template'|'none', error?: string}>}
 */
export async function generateReply({ cfg, batch, prompt, log = () => {} }) {
  if (cfg.pet.enabled) {
    const result = await petChat({ ...cfg.pet, text: prompt });
    if (result.ok) return { text: result.text, source: 'pet' };
    log(`桌宠没回话（${result.reason}）：${result.message ?? ''}`);
    if (!cfg.fallback.narrate) return { text: null, source: 'none', error: result.message };
  }

  if (!cfg.fallback.narrate) return { text: null, source: 'none' };
  const text = templateFor(batch);
  return { text, source: text ? 'template' : 'none' };
}
