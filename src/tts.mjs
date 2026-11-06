/**
 * 朗读：默认 Edge TTS（免费、音质好），失败退回 Windows SAPI。
 * 也可以接外接 HTTP 语音服务（tts.engine = 'http'）。
 * 播放用 ffplay；没有 ffplay 时用 PowerShell 的 MediaPlayer。
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EdgeTTS } from 'node-edge-tts';

const TMP_DIR = path.join(os.tmpdir(), 'douyin-live-pet');

function run(command, args, { input, timeoutMs = 60_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['pipe', 'ignore', 'pipe'], windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, error: 'timeout' });
    }, timeoutMs);
    child.on('error', (error) => {
      clearTimeout(timer);
      resolve({ ok: false, error: String(error?.message ?? error) });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, error: code === 0 ? null : stderr.trim().slice(-300) });
    });
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

async function ffplayAvailable() {
  const r = await run('ffplay', ['-version'], { timeoutMs: 8000 });
  return r.ok;
}

async function playWithFfplay(file, volume) {
  const vol = String(Math.max(0, Math.min(100, Number(volume) || 90)));
  return run('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'quiet', '-volume', vol, file], {
    timeoutMs: 120_000,
  });
}

async function playWithMediaPlayer(file) {
  const script = [
    'Add-Type -AssemblyName PresentationCore',
    '$p = New-Object System.Windows.Media.MediaPlayer',
    '$p.Open([uri]$args[0])',
    '$p.Play()',
    'Start-Sleep -Milliseconds 400',
    'while (-not $p.NaturalDuration.HasTimeSpan) { Start-Sleep -Milliseconds 100 }',
    'Start-Sleep -Milliseconds ([int]$p.NaturalDuration.TimeSpan.TotalMilliseconds)',
    '$p.Close()',
  ].join('; ');
  return run('powershell.exe', ['-NoProfile', '-STA', '-Command', script, file], { timeoutMs: 120_000 });
}

async function speakSapi(text) {
  const script = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$s.Rate = 0',
    '$s.Speak([Console]::In.ReadToEnd())',
    '$s.Dispose()',
  ].join('; ');
  return run('powershell.exe', ['-NoProfile', '-Command', script], { input: text, timeoutMs: 120_000 });
}

let ffplayCache;
let chain = Promise.resolve();

async function playAny(file, volume) {
  if (ffplayCache === undefined) ffplayCache = await ffplayAvailable();
  return ffplayCache ? playWithFfplay(file, volume) : playWithMediaPlayer(file);
}

/** 外接语音服务：POST JSON {text, voice}，返回音频流 */
async function synthesizeHttp(content, cfg) {
  const endpoint = String(cfg.endpoint ?? '').trim();
  if (!/^https?:\/\//i.test(endpoint)) throw new Error('外接语音地址不合法');
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text: content, voice: cfg.voice ?? 'zh-CN-XiaoxiaoNeural' }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`外接语音服务返回 HTTP ${res.status}`);
  const type = res.headers.get('content-type') ?? '';
  if (!/^audio\/|octet-stream/i.test(type)) throw new Error(`外接语音返回的不是音频（${type || '未知类型'}）`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('外接语音返回了空音频');
  const ext = /wav/i.test(type) ? '.wav' : /ogg/i.test(type) ? '.ogg' : '.mp3';
  await fs.mkdir(TMP_DIR, { recursive: true });
  const file = path.join(TMP_DIR, `${randomUUID()}${ext}`);
  await fs.writeFile(file, buf);
  return file;
}

/**
 * @param {string} text
 * @param {{enabled?: boolean, engine?: 'edge'|'sapi'|'http'|'off', voice?: string, volume?: number, rate?: string, endpoint?: string}} cfg
 */
export async function speak(text, cfg = {}) {
  const content = String(text ?? '').trim();
  if (!content || cfg.enabled === false) return { ok: false, skipped: true };

  const { engine = 'edge', voice = 'zh-CN-XiaoxiaoNeural', volume = 90, rate = '+8%' } = cfg;
  if (engine === 'off') return { ok: false, skipped: true };

  // 串行排队：直播间消息一多，不许两条语音打架
  const job = chain.then(async () => {
    if (engine === 'sapi') {
      const r = await speakSapi(content);
      return { ok: r.ok, engine: 'sapi', error: r.error };
    }

    if (engine === 'http') {
      let file;
      try {
        file = await synthesizeHttp(content, { ...cfg, voice });
      } catch (error) {
        return { ok: false, engine: 'http', error: String(error?.message ?? error) };
      }
      try {
        const played = await playAny(file, volume);
        return { ok: played.ok, engine: 'http', error: played.error };
      } finally {
        fs.unlink(file).catch(() => {});
      }
    }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const file = path.join(TMP_DIR, `${randomUUID()}.mp3`);
    try {
      const tts = new EdgeTTS({ voice, lang: 'zh-CN', outputFormat: 'audio-24khz-48kbitrate-mono-mp3', rate });
      await tts.ttsPromise(content, file);
    } catch (error) {
      // Edge TTS 挂了（断网/接口变更）就退回系统语音，不让整条链路停摆
      const fallback = await speakSapi(content);
      return { ok: fallback.ok, engine: 'sapi-fallback', error: String(error?.message ?? error) };
    }

    try {
      const played = await playAny(file, volume);
      return { ok: played.ok, engine: 'edge', error: played.error };
    } finally {
      fs.unlink(file).catch(() => {});
    }
  });

  chain = job.catch(() => {});
  return job;
}
