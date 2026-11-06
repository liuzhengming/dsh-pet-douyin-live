import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAzureRequest,
  buildDashScopeTtsRequest,
  buildElevenLabsRequest,
  buildOpenAiSpeech,
  dashscopeRoot,
  parseDashScopeTtsResponse,
} from '../src/providers.mjs';

test('dashscopeRoot：兼容模式/带版本/指到具体接口的地址都归一成域名', () => {
  assert.equal(dashscopeRoot('https://dashscope.aliyuncs.com'), 'https://dashscope.aliyuncs.com');
  assert.equal(dashscopeRoot('https://dashscope.aliyuncs.com/'), 'https://dashscope.aliyuncs.com');
  assert.equal(dashscopeRoot('https://ws-x.cn-beijing.maas.aliyuncs.com/compatible-mode/v1'), 'https://ws-x.cn-beijing.maas.aliyuncs.com');
  assert.equal(dashscopeRoot('https://dashscope.aliyuncs.com/api/v1'), 'https://dashscope.aliyuncs.com');
  assert.equal(
    dashscopeRoot('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'),
    'https://dashscope.aliyuncs.com',
  );
  assert.equal(dashscopeRoot(''), 'https://dashscope.aliyuncs.com');
});

test('阿里云百炼：工作空间的兼容模式地址也能拼出正确接口', () => {
  const req = buildDashScopeTtsRequest({
    baseUrl: 'https://ws-x.cn-beijing.maas.aliyuncs.com/compatible-mode/v1',
    apiKey: 'k',
    model: 'qwen3-tts-flash',
    voice: 'Cherry',
    text: 'hi',
  });
  assert.equal(req.url, 'https://ws-x.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
});

test('阿里云百炼：API Key + 模型名，走 SpeechSynthesizer', () => {
  const req = buildDashScopeTtsRequest({
    baseUrl: 'https://dashscope.aliyuncs.com',
    apiKey: 'sk-test',
    model: 'cosyvoice-v2',
    voice: 'longanyang',
    text: '你好',
  });
  assert.equal(req.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
  assert.equal(req.headers.authorization, 'Bearer sk-test');
  const body = JSON.parse(req.body);
  assert.equal(body.model, 'cosyvoice-v2');
  assert.equal(body.input.text, '你好');
  assert.equal(body.input.voice, 'longanyang');
  assert.equal(body.input.format, 'mp3');
});

test('阿里云百炼：qwen 系模型走 multimodal-generation，cosyvoice 走 SpeechSynthesizer', () => {
  const q = buildDashScopeTtsRequest({ apiKey: 'k', model: 'Qwen-Audio-3.1-TTS-Flash', voice: 'Cherry', text: '你好' });
  assert.equal(q.url, 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation');
  const qb = JSON.parse(q.body);
  assert.equal(qb.model, 'Qwen-Audio-3.1-TTS-Flash');
  assert.equal(qb.input.voice, 'Cherry');
  assert.equal(qb.input.format, undefined);

  const c = buildDashScopeTtsRequest({ apiKey: 'k', model: 'cosyvoice-v2', voice: 'longanyang', text: '你好' });
  assert.equal(c.url, 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
  assert.equal(JSON.parse(c.body).input.format, 'mp3');
});

test('阿里云百炼：填了完整接口地址就不再拼路径', () => {
  const req = buildDashScopeTtsRequest({ baseUrl: 'https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer', apiKey: 'k', text: 'x' });
  assert.equal(req.url, 'https://ws-1.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer');
});

test('阿里云百炼：从 output.audio.url 取音频；失败时带服务端 message', () => {
  assert.equal(parseDashScopeTtsResponse({ output: { audio: { url: 'https://x/a.mp3' } } }), 'https://x/a.mp3');
  assert.throws(() => parseDashScopeTtsResponse({ code: 'InvalidApiKey', message: '无效的 API-key' }), /无效的 API-key/);
});

test('OpenAI 兼容：地址补 /audio/speech，带 Bearer', () => {
  const a = buildOpenAiSpeech({ baseUrl: 'https://api.openai.com/v1/', apiKey: 'k', model: 'tts-1', voice: 'alloy', text: 'hi' });
  assert.equal(a.url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(a.headers.authorization, 'Bearer k');
  assert.equal(JSON.parse(a.body).input, 'hi');

  const b = buildOpenAiSpeech({ baseUrl: 'https://api.siliconflow.cn/v1/audio/speech', apiKey: 'k', text: 'hi' });
  assert.equal(b.url, 'https://api.siliconflow.cn/v1/audio/speech');
});

test('Azure：SSML 转义，输出 mp3', () => {
  const req = buildAzureRequest({ region: 'eastasia', apiKey: 'k', voice: 'zh-CN-XiaoxiaoNeural', text: `a<b>&"'` });
  assert.match(req.url, /eastasia\.tts\.speech\.microsoft\.com/);
  assert.equal(req.headers['Ocp-Apim-Subscription-Key'], 'k');
  assert.match(req.body, /a&lt;b&gt;&amp;&quot;&apos;/);
  assert.equal(req.headers['X-Microsoft-OutputFormat'], 'audio-24khz-48kbitrate-mono-mp3');
});

test('ElevenLabs：voiceId 进路径并编码', () => {
  const req = buildElevenLabsRequest({ apiKey: 'k', voiceId: 'a/b', text: 'hi' });
  assert.match(req.url, /api\.elevenlabs\.io\/v1\/text-to-speech\/a%2Fb/);
  assert.equal(req.headers['xi-api-key'], 'k');
});
