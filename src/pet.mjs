/**
 * 和 dsh-pet 的对话通道。
 *
 * 用的是桌宠自己暴露的 HTTP 端点（dsh-pet 0.3.8）：
 *   POST /dsh-pet-7340/chat?pet=<id>&surface=<web|desktop>
 *   body {"text": "..."}
 * 返回 {ok:true, text} 是它真回的那句话，同时这句话会以气泡出现在它头顶。
 *
 * 走这条路的好处：人格、记忆、表情包、气泡全由桌宠自己处理，
 * 我们只负责把直播间的话递进去、把回话读出来。
 */

export async function petChat({
  baseUrl = 'http://127.0.0.1:52718',
  petId = 'main',
  surface = 'desktop',
  text,
  timeoutMs = 120_000,
} = {}) {
  if (!text || !String(text).trim()) return { ok: false, reason: 'empty', message: '消息为空' };

  const attempt = async (want) => {
    const url = new URL('/dsh-pet-7340/chat', baseUrl);
    url.searchParams.set('pet', petId);
    url.searchParams.set('surface', want);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ text: String(text) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  };

  let result;
  try {
    result = await attempt(surface);
  } catch (error) {
    return { ok: false, reason: 'network', message: `${baseUrl} 连不上：${error?.message ?? error}` };
  }

  // 桌宠的显示模式和 surface 对不上时换另一端再试一次
  const mismatch =
    result.body?.reason === 'pet-not-displayed' ||
    result.body?.reason === 'bad-request' ||
    (result.status === 200 && result.body && result.body.ok === false);
  if (mismatch && (result.body?.reason === 'pet-not-displayed' || result.body?.reason === 'bad-request')) {
    const other = surface === 'desktop' ? 'web' : 'desktop';
    try {
      result = await attempt(other);
    } catch (error) {
      return { ok: false, reason: 'network', message: `${baseUrl} 连不上：${error?.message ?? error}` };
    }
  }

  if (!result.body) return { ok: false, reason: 'bad-response', message: `HTTP ${result.status}` };
  if (result.body.ok === true && typeof result.body.text === 'string') {
    return { ok: true, text: result.body.text, image: result.body.image };
  }
  return {
    ok: false,
    reason: result.body.reason ?? 'unknown',
    message: result.body.message ?? `HTTP ${result.status}`,
  };
}

/** 只用来确认桌宠在线 / 参数对不对，不产生对话 */
export async function petState(baseUrl = 'http://127.0.0.1:52718') {
  try {
    const res = await fetch(new URL('/dsh-pet-7340/state', baseUrl), {
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch (error) {
    return { ok: false, message: String(error?.message ?? error) };
  }
}
