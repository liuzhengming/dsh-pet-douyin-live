/**
 * 浏览器半：DSH 设置页里的「抖音直播」栏目。
 * 注册进 settings.section 插槽，左侧设置菜单会出现入口。
 *
 * 约定：所有数据都走宿主半的 /douyin-live-pet 前缀，不直接读写文件。
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-douyin-live',
  factory: (require) => {
    const React = require('react');
    const { useCallback, useEffect, useRef, useState } = React;
    const h = React.createElement;

    const PREFIX = '/douyin-live-pet';

    async function api(path, init) {
      const res = await fetch(PREFIX + path, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...init,
        headers: { 'content-type': 'application/json; charset=utf-8', ...(init?.headers ?? {}) },
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body && body.error) || `HTTP ${res.status}`);
      return body;
    }

    const css = {
      page: { display: 'flex', flexDirection: 'column', gap: 20, maxWidth: 760 },
      card: {
        border: '1px solid var(--dsw-alias-border-l2, #e5e6eb)',
        borderRadius: 10,
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      },
      title: { margin: 0, fontSize: 15, fontWeight: 600, color: 'var(--dsw-alias-label-primary, #1d2129)' },
      desc: { margin: 0, fontSize: 12.5, lineHeight: '18px', color: 'var(--dsw-alias-label-tertiary, #86909c)' },
      row: { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
      col: { display: 'flex', flexDirection: 'column', gap: 6 },
      label: { fontSize: 13, color: 'var(--dsw-alias-label-secondary, #4e5969)' },
      input: {
        height: 30,
        padding: '0 8px',
        fontSize: 13,
        borderRadius: 6,
        border: '1px solid var(--dsw-alias-border-l2, #e5e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #1d2129)',
        minWidth: 0,
      },
      btn: {
        height: 30,
        padding: '0 12px',
        fontSize: 13,
        borderRadius: 6,
        cursor: 'pointer',
        border: '1px solid var(--dsw-alias-border-l2, #e5e6eb)',
        background: 'var(--dsw-alias-bg-layer-1, #fff)',
        color: 'var(--dsw-alias-label-primary, #1d2129)',
      },
      primary: {
        background: 'var(--dsw-alias-state-business-primary, #165dff)',
        borderColor: 'transparent',
        color: '#fff',
      },
      danger: { color: 'var(--dsw-alias-state-error-primary, #f53f3f)' },
      badge: (ok) => ({
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        padding: '2px 8px',
        borderRadius: 999,
        background: ok ? 'rgba(0,180,42,.12)' : 'rgba(245,63,63,.12)',
        color: ok ? 'var(--dsw-alias-state-success-primary, #00b42a)' : 'var(--dsw-alias-state-error-primary, #f53f3f)',
      }),
      mono: {
        fontFamily: 'var(--dsw-font-family-mono, monospace)',
        fontSize: 12,
        background: 'var(--dsw-alias-bg-layer-2, #f7f8fa)',
        padding: '6px 8px',
        borderRadius: 6,
        wordBreak: 'break-all',
      },
      logList: { display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 320, overflowY: 'auto' },
      logItem: {
        borderLeft: '2px solid var(--dsw-alias-border-l2, #e5e6eb)',
        paddingLeft: 8,
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
      },
      logMeta: { fontSize: 11.5, color: 'var(--dsw-alias-label-tertiary, #86909c)' },
      logText: { fontSize: 13, color: 'var(--dsw-alias-label-primary, #1d2129)' },
      logReply: { fontSize: 13, color: 'var(--dsw-alias-state-business-primary, #165dff)' },
    };

    const Field = ({ label, hint, children }) =>
      h('label', { style: css.col }, h('span', { style: css.label }, label), children, hint ? h('span', { style: css.desc }, hint) : null);

    const Text = ({ value, onChange, placeholder, width = 260, mono }) =>
      h('input', {
        style: { ...css.input, width, ...(mono ? css.mono : null) },
        value: value ?? '',
        placeholder,
        onChange: (e) => onChange(e.target.value),
      });

    const Num = ({ value, onChange, min, max, width = 90 }) =>
      h('input', {
        type: 'number',
        style: { ...css.input, width },
        value: value ?? 0,
        min,
        max,
        onChange: (e) => onChange(Number(e.target.value)),
      });

    const Select = ({ value, onChange, options, width = 180 }) =>
      h(
        'select',
        { style: { ...css.input, width }, value, onChange: (e) => onChange(e.target.value) },
        options.map(([v, label]) => h('option', { key: v, value: v }, label)),
      );

    const Toggle = ({ checked, onChange, label }) =>
      h(
        'label',
        { style: { ...css.row, cursor: 'pointer', userSelect: 'none' } },
        h('input', { type: 'checkbox', checked: Boolean(checked), onChange: (e) => onChange(e.target.checked) }),
        h('span', { style: css.label }, label),
      );

    const Button = ({ children, onClick, primary, danger, disabled }) =>
      h(
        'button',
        {
          type: 'button',
          style: { ...css.btn, ...(primary ? css.primary : null), ...(danger ? css.danger : null), ...(disabled ? { opacity: 0.5, cursor: 'default' } : null) },
          onClick,
          disabled,
        },
        children,
      );

    const Card = ({ title, desc, right, children }) =>
      h(
        'section',
        { style: css.card },
        h(
          'div',
          { style: { ...css.row, justifyContent: 'space-between' } },
          h('div', null, h('h3', { style: css.title }, title), desc ? h('p', { style: css.desc }, desc) : null),
          right ?? null,
        ),
        children,
      );

    const time = (ts) => {
      const d = new Date(ts);
      return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
    };

    function SettingsPage() {
      const [config, setConfig] = useState(null);
      const [status, setStatus] = useState(null);
      const [logs, setLogs] = useState([]);
      const [room, setRoom] = useState('');
      const [note, setNote] = useState(null);
      const [busy, setBusy] = useState(false);
      const timer = useRef(null);

      const refresh = useCallback(async () => {
        try {
          const [cfg, st, his] = await Promise.all([api('/config'), api('/state'), api('/history?limit=60')]);
          setConfig(cfg);
          setStatus(st);
          setLogs(his.entries ?? []);
          setRoom((prev) => (prev ? prev : cfg.roomId ?? ''));
        } catch (error) {
          setNote({ kind: 'error', text: `读取失败：${error.message}` });
        }
      }, []);

      useEffect(() => {
        void refresh();
        timer.current = setInterval(() => {
          void api('/state').then(setStatus).catch(() => {});
          void api('/history?limit=60')
            .then((r) => setLogs(r.entries ?? []))
            .catch(() => {});
        }, 3000);
        return () => clearInterval(timer.current);
      }, [refresh]);

      const save = async (patch, okText = '已保存') => {
        setBusy(true);
        try {
          const res = await api('/config', { method: 'POST', body: JSON.stringify(patch) });
          if (res.ok === false) {
            setNote({ kind: 'error', text: (res.errors ?? ['保存失败']).join('；') });
            setConfig(res.config);
          } else {
            setConfig(res.config);
            setNote({ kind: 'ok', text: okText });
          }
        } catch (error) {
          setNote({ kind: 'error', text: `保存失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const update = (path, value, okText) => {
        const patch = {};
        let cursor = patch;
        for (let i = 0; i < path.length - 1; i += 1) {
          cursor[path[i]] = {};
          cursor = cursor[path[i]];
        }
        cursor[path[path.length - 1]] = value;
        setConfig((prev) => {
          const next = JSON.parse(JSON.stringify(prev ?? {}));
          let c = next;
          for (let i = 0; i < path.length - 1; i += 1) {
            c[path[i]] = c[path[i]] ?? {};
            c = c[path[i]];
          }
          c[path[path.length - 1]] = value;
          return next;
        });
        void save(patch, okText);
      };

      const start = async () => {
        setBusy(true);
        try {
          const res = await api('/start', { method: 'POST', body: JSON.stringify({ roomId: room }) });
          if (res.ok === false) setNote({ kind: 'error', text: res.error });
          else {
            setNote({ kind: 'ok', text: '已开始监听' });
            setStatus(res.state);
          }
        } catch (error) {
          setNote({ kind: 'error', text: `启动失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const stop = async () => {
        setBusy(true);
        try {
          const res = await api('/stop', { method: 'POST' });
          setStatus(res.state);
          setNote({ kind: 'ok', text: '已停止' });
        } catch (error) {
          setNote({ kind: 'error', text: `停止失败：${error.message}` });
        } finally {
          setBusy(false);
        }
      };

      const say = async () => {
        try {
          const res = await api('/say', { method: 'POST', body: JSON.stringify({ text: '这是抖音直播插件的语音测试。' }) });
          setNote(res.ok ? { kind: 'ok', text: '已播放测试语音' } : { kind: 'error', text: `播放失败：${res.error ?? ''}` });
        } catch (error) {
          setNote({ kind: 'error', text: `播放失败：${error.message}` });
        }
      };

      if (!config) return h('div', { style: css.desc }, '读取配置中…');

      const running = Boolean(status?.running);
      const petOnline = Boolean(status?.pet?.online);
      const tts = config.tts ?? {};
      const reply = config.reply ?? {};

      return h(
        'div',
        { style: css.page },
        note ? h('div', { style: { ...css.desc, color: note.kind === 'error' ? '#f53f3f' : '#00b42a' } }, note.text) : null,

        h(
          Card,
          {
            title: '运行状态',
            desc: '插件用独立的匿名浏览器配置打开直播间，不需要登录，也不会发弹幕或送礼。',
            right: h('span', { style: css.badge(running) }, running ? `监听中 · ${status.roomId}` : '未运行'),
          },
          h(
            'div',
            { style: css.row },
            h('span', { style: css.badge(petOnline) }, petOnline ? `桌宠已连接（${status.petId}@${status.surface}）` : '未检测到 dsh-pet'),
            h('span', { style: css.desc }, `已收 ${status?.messages ?? 0} 条 · 已回 ${status?.replies ?? 0} 次`),
          ),
          !petOnline
            ? h(
                'div',
                { style: { ...css.desc, ...css.mono } },
                `探测地址：${status?.pet?.baseUrl ?? '未知'}。没有桌宠时会降级成「播报」：只谢礼物、只回应被叫到的名字。想让它像人一样聊天，装一个 dsh-pet —— 在 DSH 插件市场搜 dsh-pet，或执行：dsh plugin --profile <你的 profile> add dsh-pet`,
              )
            : null,
          status?.lastError ? h('div', { style: { ...css.desc, color: '#f53f3f' } }, `最近错误：${status.lastError}`) : null,
          (config.errors ?? []).length
            ? h('div', { style: { ...css.desc, color: '#f53f3f' } }, `配置提醒：${config.errors.join('；')}`)
            : null,
        ),

        h(
          Card,
          { title: '直播间', desc: '填房间号，或直接粘贴 live.douyin.com 的链接。填一次就会记住，下次自动带出来。' },
          h(
            'div',
            { style: css.row },
            h(Text, { value: room, onChange: setRoom, placeholder: '例如 123456789 或 https://live.douyin.com/123456789', width: 380 }),
            h(Button, { onClick: start, primary: true, disabled: busy || running }, running ? '运行中' : '开始监听'),
            running ? h(Button, { onClick: stop, disabled: busy }, '停止') : null,
          ),
          h(
            'div',
            { style: css.row },
            h(Toggle, { checked: config.autoStart, onChange: (v) => update(['autoStart'], v), label: 'DSH 启动时自动开始' }),
            h(Toggle, { checked: config.capture?.hidden, onChange: (v) => update(['capture', 'hidden'], v), label: '后台运行（窗口移到屏幕外）' }),
          ),
          config.capture?.hidden
            ? h('p', { style: css.desc }, '后台运行不是无头模式：抖音不给无头浏览器弹幕，所以仍然是真浏览器渲染，只是窗口摆在屏幕外。')
            : null,
        ),

        h(
          Card,
          {
            title: '语音',
            desc: '默认 Edge TTS（免费）。也可以接你自己的语音服务，返回音频就行。',
            right: h(Button, { onClick: say }, '试听'),
          },
          h(
            'div',
            { style: css.row },
            h(Toggle, { checked: tts.enabled, onChange: (v) => update(['tts', 'enabled'], v), label: '启用语音' }),
            h('span', { style: css.label }, '引擎'),
            h(Select, {
              value: tts.engine,
              onChange: (v) => update(['tts', 'engine'], v),
              options: [
                ['edge', 'Edge TTS（在线，免费）'],
                ['sapi', '系统语音（离线）'],
                ['http', '外接语音服务（HTTP）'],
                ['off', '不朗读'],
              ],
              width: 220,
            }),
          ),
          tts.engine === 'edge' || tts.engine === 'sapi'
            ? h(
                'div',
                { style: css.row },
                h(Field, { label: '音色' }, h(Text, { value: tts.voice, onChange: (v) => update(['tts', 'voice'], v), width: 260, mono: true })),
                h(Field, { label: '语速' }, h(Text, { value: tts.rate, onChange: (v) => update(['tts', 'rate'], v), width: 90, mono: true })),
              )
            : null,
          tts.engine === 'http'
            ? h(
                Field,
                { label: '外接语音服务地址', hint: 'POST JSON {text, voice}，返回 audio/* 音频流即可。' },
                h(Text, { value: tts.endpoint, onChange: (v) => update(['tts', 'endpoint'], v), width: 420, mono: true, placeholder: 'http://127.0.0.1:9880/tts' }),
              )
            : null,
          h(
            'div',
            { style: css.row },
            h(Field, { label: '音量' }, h(Num, { value: tts.volume, onChange: (v) => update(['tts', 'volume'], v), min: 0, max: 100 })),
          ),
        ),

        h(
          Card,
          { title: '回话节奏', desc: '默认偏克制：20 秒起步，每分钟最多 3 次，小礼物不逐条谢。' },
          h(
            'div',
            { style: css.row },
            h(Field, { label: '最小间隔（秒）' }, h(Num, { value: reply.minIntervalSec, onChange: (v) => update(['reply', 'minIntervalSec'], v), min: 5, max: 600 })),
            h(Field, { label: '每分钟上限' }, h(Num, { value: reply.maxPerMinute, onChange: (v) => update(['reply', 'maxPerMinute'], v), min: 1, max: 60 })),
            h(Field, { label: '礼物冷却（秒）' }, h(Num, { value: reply.giftCooldownSec, onChange: (v) => update(['reply', 'giftCooldownSec'], v), min: 0, max: 600 })),
            h(Field, { label: '普通弹幕概率' }, h(Num, { value: reply.chatProbability, onChange: (v) => update(['reply', 'chatProbability'], v), min: 0, max: 1 })),
          ),
          h(
            Field,
            { label: '叫到这些词就优先回（逗号分隔）' },
            h(Text, {
              value: (reply.keywords ?? []).join(','),
              onChange: (v) => update(['reply', 'keywords'], v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)),
              width: 380,
            }),
          ),
          h(
            Field,
            { label: '这些礼物不逐条谢（逗号分隔）' },
            h(Text, {
              value: (reply.ignoreGifts ?? []).join(','),
              onChange: (v) => update(['reply', 'ignoreGifts'], v.split(/[,，]/).map((s) => s.trim()).filter(Boolean)),
              width: 380,
            }),
          ),
          h(
            'div',
            { style: css.row },
            h(Toggle, { checked: reply.includeEnter, onChange: (v) => update(['reply', 'includeEnter'], v), label: '回应「来了 / 加入直播间」' }),
            h(Toggle, { checked: reply.includeLike, onChange: (v) => update(['reply', 'includeLike'], v), label: '回应「点赞」' }),
          ),
        ),

        h(
          Card,
          {
            title: '对话记录',
            desc: '最近 60 条，存本机。',
            right: h(
              'div',
              { style: css.row },
              h(Button, { onClick: () => void refresh() }, '刷新'),
              h(Button, {
                danger: true,
                onClick: async () => {
                  await api('/history/clear', { method: 'POST' });
                  setLogs([]);
                },
              }, '清空'),
            ),
          },
          logs.length === 0
            ? h('p', { style: css.desc }, '还没有记录。开始监听后，收到的弹幕和回话会出现在这里。')
            : h(
                'div',
                { style: css.logList },
                logs
                  .slice()
                  .reverse()
                  .map((entry, i) =>
                    h(
                      'div',
                      { key: `${entry.ts}-${i}`, style: css.logItem },
                      h('span', { style: css.logMeta }, `${time(entry.ts)} · ${entry.kind}${entry.user ? ` · ${entry.user}` : ''}`),
                      h('span', { style: css.logText }, entry.text),
                      entry.reply ? h('span', { style: css.logReply }, `↩ ${entry.reply}`) : null,
                    ),
                  ),
              ),
        ),
      );
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: 'douyin-live-pet', order: 17, label: () => '抖音直播' }, SettingsPage),
      );
    }

    return { name: 'douyin-live-pet-client', inject: ['slots'], apply, SettingsPage };
  },
});
