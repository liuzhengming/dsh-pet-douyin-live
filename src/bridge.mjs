/**
 * 命令行入口：不开 DSH 设置页时也能直接跑。
 *
 *   node src/bridge.mjs --room 123456789
 *   node src/bridge.mjs --room 123456789 --dry
 *   node src/bridge.mjs --say "在吗"
 *   node src/bridge.mjs --selftest
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, deepMerge, normalizeConfig, normalizeRoom, readConfig, configFile } from './config.mjs';
import { LiveEngine } from './engine.mjs';
import { createHistory } from './history.mjs';
import { generateReply, checkPet } from './reply.mjs';
import { buildPrompt } from './parser.mjs';
import { speak } from './tts.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, 'logs');

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function loadCliConfig(args) {
  // --config 指定文件；否则读仓库里的 config.json；都没有就用默认值
  const file = args.config ? path.resolve(ROOT, args.config) : path.join(ROOT, 'config.json');
  let raw = {};
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`配置文件读不动：${error.message}`);
  }
  return normalizeConfig(deepMerge(DEFAULTS, raw)).config;
}

function createLogger() {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const file = path.join(LOG_DIR, `bridge-${new Date().toISOString().slice(0, 10)}.log`);
  return (line) => {
    const stamp = new Date().toISOString().slice(11, 19);
    const text = `[${stamp}] ${line}`;
    console.log(text);
    try {
      fs.appendFileSync(file, `${text}\n`, 'utf8');
    } catch {
      /* 日志写不进去不影响主流程 */
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const log = createLogger();
  const cfg = loadCliConfig(args);
  if (args.profile) cfg.capture.profileDir = path.resolve(ROOT, String(args.profile));

  if (args.selftest) {
    const pet = await checkPet(cfg.pet);
    log(`桌宠：${pet.online ? '在线' : `不可用（${pet.reason}）`}`);
    const batch = [{ kind: 'chat', user: '自检', text: '能听见我说话吗？' }];
    const result = await generateReply({ cfg, batch, prompt: buildPrompt(batch), log });
    log(result.text ? `回话（${result.source}）：${result.text}` : '没有回话');
    const spoken = await speak(result.text ?? '自检语音', cfg.tts);
    log(`朗读：${spoken.ok ? '成功' : `失败（${spoken.error ?? ''}）`}`);
    return;
  }

  if (args.say) {
    const text = args._.join(' ').trim() || '这是一句测试语音。';
    const batch = [{ kind: 'chat', user: '主人', text }];
    const result = await generateReply({ cfg, batch, prompt: buildPrompt(batch), log });
    if (result.text) log(`回话（${result.source}）：${result.text}`);
    const spoken = await speak(result.text ?? text, cfg.tts);
    log(`朗读：${spoken.ok ? '成功' : `失败（${spoken.error ?? ''}）`}`);
    return;
  }

  const room = normalizeRoom(args.room ?? cfg.roomId);
  if (!room) throw new Error('没给直播间号：--room <房间号>，或写进 config.json 的 roomId');

  const history = createHistory({ file: path.join(ROOT, 'logs', 'history.jsonl') });
  const engine = new LiveEngine({ config: cfg, history, log, dry: Boolean(args.dry) });
  log(
    `启动：房间 ${room}，桌宠 ${cfg.pet.enabled ? `${cfg.pet.petId}@${cfg.pet.surface}` : '关'}，TTS ${cfg.tts.enabled ? cfg.tts.engine : '关'}${args.dry ? '，dry 模式' : ''}`,
  );

  await engine.start(room);

  let stopped = false;
  const stop = async (reason) => {
    if (stopped) return;
    stopped = true;
    await engine.stop(reason);
    process.exit(0);
  };
  process.on('SIGINT', () => void stop('Ctrl+C'));
  process.on('SIGTERM', () => void stop('SIGTERM'));

  if (args.seconds) {
    setTimeout(() => void stop(`到达 --seconds ${args.seconds} 上限`), Number(args.seconds) * 1000);
  }
}

main().catch((error) => {
  console.error(`出错了：${error?.message ?? error}`);
  process.exit(1);
});
