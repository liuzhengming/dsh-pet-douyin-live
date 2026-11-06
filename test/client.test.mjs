/**
 * 客户端 bundle 的形状测试：不启动浏览器，用假的 __ModuleLoader__ 把 client.js 跑一遍，
 * 确认它注册了 settings.section、标签是「抖音直播」、并且页面组件能渲染成 React 元素。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadClient() {
  const code = fs.readFileSync(path.join(ROOT, 'client.js'), 'utf8');
  let loaded = null;
  const window = {
    __ModuleLoader__: {
      load(def) {
        loaded = def;
      },
    },
  };
  const context = vm.createContext({ window, console, fetch: async () => ({ ok: true, json: async () => ({}) }) });
  vm.runInContext(code, context, { filename: 'client.js' });
  assert.ok(loaded, 'client.js 没有调用 __ModuleLoader__.load');
  assert.equal(loaded.id, 'dsh-douyin-live-pet');

  const React = {
    createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
    useState: (v) => [v, () => {}],
    useEffect: () => {},
    useCallback: (fn) => fn,
    useRef: (v) => ({ current: v }),
  };
  const plugin = loaded.factory((id) => {
    if (id === 'react') return React;
    throw new Error(`未预期的模块：${id}`);
  });
  return { plugin, React };
}

test('client bundle：导出的插件对象形状正确', () => {
  const { plugin } = loadClient();
  assert.equal(plugin.name, 'douyin-live-pet-client');
  assert.ok(plugin.inject.includes('slots'));
  assert.equal(typeof plugin.apply, 'function');
  assert.equal(typeof plugin.SettingsPage, 'function');
});

test('client bundle：apply 会把「抖音直播」注册进 settings.section', () => {
  const { plugin } = loadClient();
  const registered = [];
  let injected = null;
  const ctx = {
    slots: {
      inject(name, fn) {
        injected = name;
        fn();
      },
      register(meta, component) {
        registered.push({ meta, component });
        return () => {};
      },
    },
  };
  plugin.apply(ctx);
  assert.equal(injected, 'settings.section');
  assert.equal(registered.length, 1);
  assert.equal(registered[0].meta.name, 'settings.section');
  assert.equal(registered[0].meta.id, 'douyin-live-pet');
  assert.equal(registered[0].meta.label(), '抖音直播');
  assert.equal(typeof registered[0].component, 'function');
});

test('client bundle：页面首帧能渲染（未挂载状态下不抛错）', () => {
  const { plugin } = loadClient();
  // 设置页在 useConfig 之前会先渲染「读取配置中…」，这里只验证组件可调用
  const element = plugin.SettingsPage({});
  assert.ok(element, '组件返回了空值');
  assert.equal(typeof element, 'object');
});
