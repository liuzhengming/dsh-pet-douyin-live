/**
 * 各家语音合成接口，统一成「文本进、音频 Buffer 出」。
 *
 * 阿里云用百炼（DashScope）的 CosyVoice HTTP 接口：
 *   POST {base}/api/v1/services/audio/tts/SpeechSynthesizer
 *   Authorization: Bearer <API Key>
 *   { model, input: { text, voice, format, sample_rate } }
 * 非流式返回 JSON，音频在 output.audio.url（24 小时有效），再下载一次。
 */
import crypto from 'node:crypto';

const DASHSCOPE_PATH = '/api/v1/services/audio/tts/SpeechSynthesizer';

/** 阿里云百炼：API Key + 模型名 + 音色 */
export function buildDashScopeTtsRequest({
  baseUrl = 'https://dashscope.aliyuncs.com',
  apiKey,
  model = 'cosyvoice-v2',
  voice = 'longanyang',
  text,
  sampleRate = 24000,
}) {
  const root = String(baseUrl).replace(/\/+$/, '');
  const url = root.endsWith(DASHSCOPE_PATH) ? root : `${root}${DASHSCOPE_PATH}`;
  return {
    url,
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, input: { text, voice, format: 'mp3', sample_rate: sampleRate } }),
  };
}

/** 从百炼响应里取音频地址；失败时抛出带服务端 message 的错误 */
export function parseDashScopeTtsResponse(json) {
  const url = json?.output?.audio?.url;
  if (url) return url;
  const message = json?.message || json?.code || JSON.stringify(json).slice(0, 200);
  throw new Error(`阿里云合成失败：${message}`);
}

/** OpenAI 兼容的 /audio/speech（OpenAI、硅基流动、各类中转都吃这套） */
export function buildOpenAiSpeech({ baseUrl = 'https://api.openai.com/v1', apiKey, model = 'tts-1', voice = 'alloy', text }) {
  const root = String(baseUrl).replace(/\/+$/, '');
  return {
    url: /\/audio\/speech$/.test(root) ? root : `${root}/audio/speech`,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, voice, input: text, response_format: 'mp3' }),
  };
}

function escapeXml(value) {
  return String(value).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
}

/** Azure 语音服务：SSML 进，mp3 出 */
export function buildAzureRequest({ region = 'eastasia', apiKey, voice = 'zh-CN-XiaoxiaoNeural', rate = '+8%', text }) {
  const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="zh-CN"><voice name="${escapeXml(voice)}"><prosody rate="${escapeXml(rate)}">${escapeXml(text)}</prosody></voice></speak>`;
  return {
    url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
    headers: {
      'Ocp-Apim-Subscription-Key': apiKey,
      'content-type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-48kbitrate-mono-mp3',
      'user-agent': 'dsh-pet-douyin-live',
    },
    body: ssml,
  };
}

/** ElevenLabs */
export function buildElevenLabsRequest({ apiKey, voiceId, text, modelId = 'eleven_multilingual_v2' }) {
  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`,
    headers: { 'content-type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ text, model_id: modelId }),
  };
}

/** 二进制音频响应 → Buffer */
export async function fetchAudio({ url, headers, body }, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(timeoutMs) });
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`${res.status} ${text.slice(0, 180)}`);
  }
  if (/json/i.test(type)) {
    const text = await res.text().catch(() => '');
    throw new Error(`服务返回错误：${text.slice(0, 180)}`);
  }
  if (!/^audio\/|octet-stream/i.test(type)) throw new Error(`返回的不是音频（${type || '未知类型'}）`);
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('返回了空音频');
  return { buffer, ext: /wav/i.test(type) ? '.wav' : /ogg/i.test(type) ? '.ogg' : '.mp3' };
}

async function downloadAudio(url, { timeoutMs = 60_000 } = {}) {
  const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`下载音频失败：HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('下载到空音频');
  return { buffer, ext: /wav/i.test(type) ? '.wav' : /ogg/i.test(type) ? '.ogg' : '.mp3' };
}

/**
 * 按 provider 合成一段音频。
 * @returns {Promise<{buffer:Buffer, ext:string}>}
 */
export async function synthesize(provider, text, cfg) {
  if (provider === 'aliyun') {
    const a = cfg.aliyun ?? {};
    if (!a.apiKey) throw new Error('阿里云：没填 API Key');
    const req = buildDashScopeTtsRequest({
      baseUrl: a.baseUrl,
      apiKey: a.apiKey,
      model: a.model,
      voice: a.voice,
      text,
      sampleRate: a.sampleRate,
    });
    const res = await fetch(req.url, {
      method: 'POST',
      headers: req.headers,
      body: req.body,
      signal: AbortSignal.timeout(60_000),
    });
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`阿里云 HTTP ${res.status}：${json?.message ?? ''}`);
    return downloadAudio(parseDashScopeTtsResponse(json));
  }

  if (provider === 'openai') {
    const o = cfg.openai ?? {};
    if (!o.apiKey) throw new Error('OpenAI 兼容：没填 API Key');
    return fetchAudio(buildOpenAiSpeech({ baseUrl: o.baseUrl, apiKey: o.apiKey, model: o.model, voice: o.voice, text }));
  }

  if (provider === 'azure') {
    const z = cfg.azure ?? {};
    if (!z.apiKey) throw new Error('Azure：没填订阅 Key');
    return fetchAudio(buildAzureRequest({ region: z.region, apiKey: z.apiKey, voice: z.voice, rate: cfg.rate, text }));
  }

  if (provider === 'elevenlabs') {
    const e = cfg.elevenlabs ?? {};
    if (!e.apiKey) throw new Error('ElevenLabs：没填 API Key');
    return fetchAudio(buildElevenLabsRequest({ apiKey: e.apiKey, voiceId: e.voiceId, text }));
  }

  throw new Error(`未知的语音引擎：${provider}`);
}

/** 仅供测试/调试：生成一次性 nonce */
export function nonce() {
  return crypto.randomUUID();
}
