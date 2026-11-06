/**
 * 气泡朗读：轮询桌宠的 /state，只要桌宠头顶冒出新气泡就念出来。
 *
 * 覆盖所有来源：碎碎念、/chat 回复、余额播报、工作状态提示……
 * 用 say.counter 判断「是不是新气泡」，首轮只记基线不补念历史。
 */
const DEFAULT_INTERVAL = 1200;

export function createBubbleWatcher({
  getConfig,
  fetchJson = async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  },
  onBubble,
  onError = () => {},
  now = () => Date.now(),
}) {
  let timer = null;
  let running = false;
  const baseline = new Map(); // petId -> 上次看到的 counter
  const lastText = new Map(); // petId -> { text, at }
  const SAME_TEXT_WINDOW = 30_000;
  const stats = { ticks: 0, fired: 0, lastTickAt: 0, lastError: null, lastBubbleAt: 0, lastBubble: null };

  async function tick() {
    const cfg = getConfig?.();
    if (!cfg?.bubble?.enabled || !cfg?.pet?.enabled) return;
    const base = String(cfg.pet.baseUrl ?? '').trim();
    if (!base) return;

    let state;
    try {
      state = await fetchJson(new URL('/dsh-pet-7340/state', base).toString());
      stats.ticks += 1;
      stats.lastTickAt = now();
      stats.lastError = null;
    } catch (error) {
      stats.lastError = String(error?.message ?? error).slice(0, 160);
      onError(error);
      return;
    }

    const pets = state?.pets ?? {};
    const wantId = cfg.pet.petId;
    const entries = wantId && pets[wantId] ? [[wantId, pets[wantId]]] : Object.entries(pets);

    for (const [petId, pet] of entries) {
      const counter = Number(pet?.say?.counter ?? 0);
      const text = String(pet?.say?.data?.text ?? '').trim();
      if (!counter || !text) continue;

      const prev = baseline.get(petId);
      baseline.set(petId, counter);
      if (prev === undefined) continue; // 首轮：只记基线，不念旧气泡
      if (counter === prev) continue;

      // 同一句在 30 秒内只念一次：气泡可能被重新推送，重复念会很吵
      const seen = lastText.get(petId);
      const now_ = now();
      if (seen && seen.text === text && now_ - seen.at < SAME_TEXT_WINDOW) continue;
      lastText.set(petId, { text, at: now_ });

      stats.fired += 1;
      stats.lastBubbleAt = now_;
      stats.lastBubble = text.slice(0, 80);
      onBubble?.({ petId, text, image: pet?.say?.data?.image ?? null, at: now_ });
    }
  }

  return {
    tick,
    start() {
      if (running) return;
      running = true;
      timer = setInterval(() => {
        void tick();
      }, DEFAULT_INTERVAL);
      // 不 unref：DSH 宿主是长命进程，unref 在部分 Electron 环境里会让定时器饿死
      void tick();
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      baseline.clear();
      lastText.clear();
    },
    stats() {
      return { running, ...stats };
    },
    get running() {
      return running;
    },
  };
}
