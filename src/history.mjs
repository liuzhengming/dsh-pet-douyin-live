/**
 * 对话记录：一行一条 JSON，追加写，读取时倒序取最近 N 条。
 * 记录里不放 cookie、不放页面 HTML，只存观众消息和桌宠的回话。
 */
import fs from 'node:fs';
import path from 'node:path';

export function createHistory({ file, limit = 2000 }) {
  return {
    /** @param {{kind:string,user:string|null,text:string,reply:string|null,reason?:string,ok?:boolean}} entry */
    append(entry) {
      const record = {
        ts: Date.now(),
        kind: entry.kind,
        user: entry.user ?? null,
        text: String(entry.text ?? '').slice(0, 500),
        reply: entry.reply == null ? null : String(entry.reply).slice(0, 500),
        reason: entry.reason ?? null,
        ok: entry.ok !== false,
      };
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify(record)}\n`, 'utf8');
      this.trim();
      return record;
    },

    /** 最近的记录，按时间正序返回（老的在前，方便直接渲染） */
    list(count = 50) {
      let lines;
      try {
        lines = fs.readFileSync(file, 'utf8').split('\n');
      } catch {
        return [];
      }
      const out = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          out.push(JSON.parse(line));
        } catch {
          /* 坏行跳过，不让一条脏数据毁掉整个历史 */
        }
      }
      return out.slice(-Math.max(1, Math.min(limit, Number(count) || 50)));
    },

    clear() {
      try {
        fs.unlinkSync(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      return true;
    },

    path() {
      return file;
    },

    /** 超过 limit*2 时重写成最近 limit 条，避免无限长 */
    trim() {
      let lines;
      try {
        lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
      } catch {
        return;
      }
      if (lines.length <= limit * 2) return;
      const kept = lines.slice(-limit);
      fs.writeFileSync(file, `${kept.join('\n')}\n`, 'utf8');
    },
  };
}
