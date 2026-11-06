/**
 * 记一下「刚刚是我们自己念过的」文本，避免同一句话读两遍。
 *
 * 场景：直播回话时引擎已经念过桌宠的回话，而同一句话也会以气泡形式出现，
 * 气泡监听器不能再念一次。
 */
const TTL_MS = 20_000;
const spoken = new Map();

export function markSpoken(text) {
  const key = String(text ?? '').trim();
  if (!key) return;
  spoken.set(key, Date.now());
  if (spoken.size > 200) {
    const now = Date.now();
    for (const [k, ts] of spoken) if (now - ts > TTL_MS) spoken.delete(k);
  }
}

export function wasRecentlySpoken(text, now = Date.now()) {
  const key = String(text ?? '').trim();
  const ts = spoken.get(key);
  if (ts === undefined) return false;
  if (now - ts > TTL_MS) {
    spoken.delete(key);
    return false;
  }
  return true;
}

export function resetSpoken() {
  spoken.clear();
}
