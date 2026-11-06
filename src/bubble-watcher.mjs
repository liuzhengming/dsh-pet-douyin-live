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

  async function tick() {
    const cfg = getConfig?.();
    if (!cfg?.bubble?.enabled || !cfg?.pet?.enabled) return;
    const base = String(cfg.pet.baseUrl ?? '').trim();
    if (!base) return;

    let state;
    try {
      state = await fetchJson(new URL('/dsh-pet-7340/state', base).toString());
    } catch (error) {
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
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      running = false;
      if (timer) clearInterval(timer);
      timer = null;
      baseline.clear();
      lastText.clear();
    },
    get running() {
      return running;
    },
  };
}
