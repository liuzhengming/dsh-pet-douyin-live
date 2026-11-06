/**
 * DSH 宿主半：把直播引擎挂到一个 HTTP 前缀上，给设置页用。
 * 路由前缀 /douyin-live-pet：
 *   GET  /state          运行状态
 *   GET  /config         当前配置（含校验错误）
 *   POST /config         保存配置（部分字段即可）
 *   POST /start          开始监听（可带 roomId）
 *   POST /stop           停止
 *   GET  /history        最近对话记录
 *   POST /history/clear  清空记录
 *   POST /say            试听一句话
 *   GET  /pet            桌宠连通性
 */
import { configFile, historyFile, normalizeRoom, publicConfig, readConfig, resolvePetBaseUrl, writeConfig } from './config.mjs';
import { LiveEngine } from './engine.mjs';
import { createHistory } from './history.mjs';
import { checkPet } from './reply.mjs';
import { speak } from './tts.mjs';

export const name = 'douyin-live-pet';
export const inject = ['webServer'];

const PREFIX = '/douyin-live-pet';
const MAX_BODY = 64 * 1024;

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) return resolve({});
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

export function apply(ctx) {
  // DSH 每次启动端口都可能变，桌宠的 /dsh-pet-7340/* 路由跟着 DSH 走，
  // 所以没显式配置时按当前 Web 端口现算。
  const webPort = () => (typeof ctx.webServer?.port === 'number' ? ctx.webServer.port : 0);
  const resolved = (cfg) => ({ ...cfg, pet: { ...cfg.pet, baseUrl: resolvePetBaseUrl(cfg.pet.baseUrl, webPort()) } });

  let config = resolved(readConfig());
  const history = createHistory({ file: historyFile() });
  const log = (line) => console.log(`[douyin-live-pet] ${line}`);
  const engine = new LiveEngine({ config, history, log });

  const reload = () => {
    config = resolved(readConfig());
    engine.updateConfig(config);
    return config;
  };

  const handle = async (req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const route = url.pathname.replace(/^\/douyin-live-pet/, '') || '/';
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      if (route === '/state' && method === 'GET') {
        const pet = await checkPet(config.pet);
        return sendJson(res, 200, {
          ...engine.status(),
          pet: { online: pet.online, reason: pet.reason ?? null, enabled: config.pet.enabled, baseUrl: config.pet.baseUrl },
          petId: config.pet.petId,
          surface: config.pet.surface,
          configErrors: config.errors ?? [],
        });
      }

      if (route === '/config' && method === 'GET') {
        return sendJson(res, 200, publicConfig(config));
      }

      if (route === '/config' && method === 'POST') {
        const patch = await readBody(req);
        const saved = writeConfig(patch, configFile());
        if (!saved.ok) return sendJson(res, 200, { ok: false, errors: saved.errors, config: publicConfig(saved.config) });
        config = { ...resolved(saved.config), errors: [] };
        engine.updateConfig(config);
        return sendJson(res, 200, { ok: true, config: publicConfig(config) });
      }

      if (route === '/start' && method === 'POST') {
        const body = await readBody(req);
        const room = normalizeRoom(body.roomId ?? config.roomId);
        if (!room) return sendJson(res, 200, { ok: false, error: '先填直播间房间号或链接' });
        if (config.roomId !== room) {
          const saved = writeConfig({ roomId: room }, configFile());
          if (saved.ok) {
            config = { ...resolved(saved.config), errors: [] };
            engine.updateConfig(config);
          }
        }
        await engine.start(room);
        return sendJson(res, 200, { ok: true, state: engine.status() });
      }

      if (route === '/stop' && method === 'POST') {
        await engine.stop('设置页停止');
        return sendJson(res, 200, { ok: true, state: engine.status() });
      }

      if (route === '/history' && method === 'GET') {
        const limit = Number(url.searchParams.get('limit') ?? 50);
        return sendJson(res, 200, { ok: true, entries: history.list(limit) });
      }

      if (route === '/history/clear' && method === 'POST') {
        history.clear();
        return sendJson(res, 200, { ok: true });
      }

      if (route === '/say' && method === 'POST') {
        const body = await readBody(req);
        const text = String(body.text ?? '').trim();
        if (!text) return sendJson(res, 200, { ok: false, error: '没有要朗读的内容' });
        const spoken = await speak(text, config.tts);
        return sendJson(res, 200, { ok: spoken.ok, engine: spoken.engine, error: spoken.error ?? null });
      }

      if (route === '/pet' && method === 'GET') {
        const pet = await checkPet(config.pet);
        return sendJson(res, 200, { ok: true, ...pet, baseUrl: config.pet.baseUrl, petId: config.pet.petId });
      }

      return sendJson(res, 404, { error: 'not found' });
    } catch (error) {
      return sendJson(res, 500, { error: String(error?.message ?? error) });
    }
  };

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: PREFIX,
      handler: (req, res) => {
        void handle(req, res);
      },
    }),
  );

  ctx.effect(() => () => {
    void engine.stop('插件卸载');
  });

  if (config.autoStart && config.roomId) {
    setTimeout(() => {
      void engine.start(config.roomId).catch((error) => log(`自动开始失败：${error?.message ?? error}`));
    }, 3000);
  }
}
