# 项目约定

## 发版（重要）

- **每次发布 npm 之前，必须先升级 `package.json` 的 `version`**。
  npm 不允许同一个版本号重复发布，忘升级会直接失败（`EPUBLISHCONFLICT` / `cannot publish over`）。
- 升级后要跑一遍 `npm test`（37 项，含需要本机 Edge 的采集器测试）。
- 发布需要账号 2FA，由维护者本人在终端执行 `npm publish`。
- 只改文档、不打算发版时，可以不升版本。

```powershell
npm version patch --no-git-tag-version   # 0.3.0 → 0.3.1
npm test
git add -A; git commit -m "chore: 0.3.1"; git push
npm publish
```

## 代码约定

- `cordis.patch.yml` 里的 entry id 必须与包名一致（DSH 按它比对）。
- `client.js` 的 `__ModuleLoader__.load({ id })` 用包名。
- 新增采集规则优先加到 `src/parser.mjs` 的 `NOISE_PATTERNS`，并为它补一条单测。
- 插件与命令行共用 `src/engine.mjs`，不要各写一套循环。
