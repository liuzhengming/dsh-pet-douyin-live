# douyin-live-pet

> 把抖音直播间的弹幕和礼物，变成 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 头顶的气泡，再读出声。

不逆向抖音的私有协议，也不碰签名：直接开一个真 Edge 打开直播间网页，读页面上的聊天区，
把新消息攒成一批丢给桌宠，让它用自己的人格和记忆回一句，再由 Edge TTS 念出来。

```
抖音直播间网页（Edge，匿名即可）
        │  聊天区新增的 DOM 文本
        ▼
  src/inpage.mjs        页面内采集器
        │  每 400ms 取一次
        ▼
  src/parser.mjs        分类 / 去重 / 过滤噪声 / 拼提示词
        │
        ▼
  POST /dsh-pet-7340/chat?pet=main&surface=desktop
        │  {ok:true, text}   ← 同一句话会以气泡出现在桌宠头顶
        ▼
  src/tts.mjs           Edge TTS → ffplay
```

## 特性

- **实时**：评论、弹幕、礼物、进场、点赞，进页面就采，延迟约 1 秒
- **不用登录**：匿名打开直播间就能看到弹幕；登录只是可选项
- **像人话**：回复由桌宠自己生成，人格、记忆、表情包全部沿用它的
- **能出声**：Edge TTS（免费、音质好），失败自动退回系统语音
- **不刷屏**：最小间隔、每分钟上限、礼物独立冷却、1 钻小礼物默认不谢
- **抗改版**：选择器打不中时，按「新增短文本最频繁的容器」自动认聊天区
- **只读**：不发弹幕、不送礼、不点赞

## 环境要求

| 依赖 | 说明 |
|---|---|
| Windows 10/11 | 目前只在 Windows 上跑通（Edge + PowerShell + ffplay） |
| Node.js ≥ 20 | 需要全局 `fetch` 与 `AbortSignal.timeout` |
| Microsoft Edge | 采集用系统 Edge（`channel: msedge`），**不需要** `playwright install` |
| ffplay | 来自 ffmpeg，用来播放语音；没有会退回 PowerShell MediaPlayer，再不行退回 SAPI |
| DeepSeek Harness + dsh-pet | 桌宠需在跑，默认 `http://127.0.0.1:52718` |
| 抖音 | 不需要账号，不需要登录 |

## 安装

```powershell
git clone git@github.com:liuzhengming/douyin-live-pet.git
cd douyin-live-pet
npm install
```

`npm install` 只装两个依赖：`playwright-core`（复用系统 Edge，不下载浏览器）和 `node-edge-tts`。

## 快速开始

**1. 确认桌宠在线**（DSH 开着、桌宠在工作即可）：

```powershell
curl.exe http://127.0.0.1:52718/dsh-pet-7340/state
```

返回 `{"counter":...}` 就说明通道可用。端口以你的 DSH 实际地址为准。

**2. 找一个正在直播的房间号**：

```powershell
npm run discover
```

输出形如 `170276491197  南美撞车了，回国首播 @耀阳环游记 5383`，前面那串数字就是房间号
（`https://live.douyin.com/170276491197` 里最后一段）。

**3. 跑起来**：

```powershell
npm start -- --room 170276491197
```

会弹出一个 Edge 窗口（保持打开，可以最小化）。终端里能看到每条弹幕，以及桌宠的回话：

```
[15:45:55] [chat] 费哥干走心｜关住了，还能出来么
[15:45:57] 桌宠回话（1187ms）：夫妻同心，我也佩服～
```

`Ctrl+C` 停止并关闭浏览器。

## 常用命令

| 命令 | 作用 |
|---|---|
| `npm start -- --room <房间号>` | 正常跑：采集 → 桌宠回话 → 朗读 |
| `npm start -- --room <房间号> --dry` | 只打印，不叫桌宠也不出声（先看采到的是什么） |
| `npm start -- --room <房间号> --seconds 90` | 跑固定时长后自动收工 |
| `npm start -- --room <房间号> --profile browser-profile` | 用已登录的身份跑（默认匿名） |
| `npm run inspect -- --room <房间号> --seconds 60` | 校准：逐行打印采集结果和容器诊断 |
| `npm run discover` | 列几个正在直播的房间号 |
| `npm run anon-check -- --room <房间号>` | 只看这个房间匿名能不能看到弹幕 |
| `npm run say -- "在吗"` | 单独试一句：桌宠回话 + 朗读 |
| `npm test` | 跑测试（24 项，需要本机有 Edge） |

## 配置

```powershell
Copy-Item config.example.json config.json
```

不建 `config.json` 也能跑，会全用内置默认值。字段：

| 键 | 默认 | 说明 |
|---|---|---|
| `roomId` | 空 | 写死房间号后，`npm start` 不用再带 `--room` |
| `pet.baseUrl` | `http://127.0.0.1:52718` | DSH 地址（桌面版/Web 版端口可能不同） |
| `pet.petId` | `main` | 桌宠 id，见 `~/.dsh/dsh-pet/main-config.jsonc` |
| `pet.surface` | `desktop` | 桌宠显示在哪端；和 `display` 对不上会自动换另一端重试 |
| `reply.minIntervalSec` | 20 | 两次回话的最小间隔 |
| `reply.maxPerMinute` | 3 | 每分钟最多回几次 |
| `reply.giftCooldownSec` | 45 | 礼物致谢的独立冷却 |
| `reply.keywordCooldownSec` | 10 | 弹幕里叫到名字时更积极 |
| `reply.chatProbability` | 0.35 | 普通弹幕的响应概率 |
| `reply.keywords` | 鱼 / 小女仆 / 主播 | 命中就优先回，改成你自己的称呼 |
| `reply.ignoreGifts` | 小心心 / 粉丝团灯牌 / 人气票 / 加油鸭 / 棒棒糖 | 这些小礼物不逐条谢，否则变复读机 |
| `reply.includeEnter` | false | 要不要回应「来了 / 加入了直播间」 |
| `reply.includeLike` | false | 要不要回应「为主播点赞了」 |
| `reply.maxBatch` | 6 | 一次最多把几条消息塞给桌宠 |
| `tts.engine` | `edge` | `edge`（Edge TTS）或 `sapi`（系统语音） |
| `tts.voice` | `zh-CN-XiaoxiaoNeural` | 也可用 `zh-CN-YunxiNeural`、`zh-CN-XiaoyiNeural` 等 |
| `tts.volume` | 90 | 0–100 |
| `tts.rate` | `+8%` | 语速，`+0%` 为原速 |
| `capture.pollMs` | 400 | 轮询间隔；调小更实时，但更吃 CPU |
| `capture.profileDir` | `browser-profile-anon` | 独立浏览器配置目录；换 `browser-profile` 用登录身份 |

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| 一条弹幕都没有 | 房间没人说话 | 换个人多的房间，或 `npm run inspect` 看原始输出 |
| 终端里全是「99钻 xxx」「1 昵称」 | 采到了礼物价目表和榜单 | 正常，解析层已过滤；若仍漏，跑 `inspect` 把漏的行贴到 issue |
| 页面显示「聊天功能不可用 / 需先登录」 | 那是**发评论**的限制 | 不影响查看，忽略 |
| 桌宠不回话 | 端点不通 / id 不对 | `curl http://127.0.0.1:52718/dsh-pet-7340/state`；核对 `pet.petId` 与 `pet.surface` |
| 没声音 | 没有 ffplay，或 Edge TTS 被墙 | 装 ffmpeg；或把 `tts.engine` 改成 `sapi` |
| 弹幕重复 | 页面同时以整行和子节点插入 | 已按 45 秒窗口去重；仍有就把间隔调大 |
| 换房间后失效 | 抖音改版 | `npm run inspect -- --room <新房间号> --html` 看 DOM，改 `src/inpage.mjs` 的选择器 |

## 已知限制

- **只读**：不发送弹幕、不送礼、不点赞；所有写操作都不在范围内。
- **依赖网页结构**：抖音改版时 class 名会变。采集器用「短文本 + 新增节点 + 高频父容器」兜底，
  真采不到就跑 `inspect` 重新校准，改一个文件即可。
- **视频区那层 canvas 弹幕抓不到**（`CanvasDanmakuPlugin` 画在画布上，DOM 里没有文本）。
  不影响使用：右侧聊天区里有同样的内容。
- **同一时刻只能守一个房间**。
- **只在 Windows 上验证过**。macOS/Linux 理论上可用，但 `tts.mjs` 里的播放和 SAPI 分支是 Windows 的。

## 目录结构

```
src/inpage.mjs        注入页面的采集器（唯一强依赖 DOM 结构的地方）
src/capture.mjs       Edge 启动、注入、drain、诊断
src/parser.mjs        分类 / 解析 / 去重 / 拼提示词（纯函数）
src/policy.mjs        什么时候该回话（纯函数）
src/pet.mjs           调 dsh-pet 的 /chat
src/tts.mjs           Edge TTS + 播放 + SAPI 兜底
src/bridge.mjs        主循环
src/inspect.mjs       校准：逐行打印采集结果
src/discover.mjs      找房间
src/anon-check.mjs    匿名可见性检查
src/login.mjs         可选：扫码登录（默认不需要）
src/whoami.mjs        查登录态（只打印 cookie 名）
src/probe.mjs         结构探针
src/where-danmaku.mjs 扫左下区域的短文本节点
src/why-no-chat.mjs   查「聊天不可用」的原因
test/                 24 个测试
```

## 开发与测试

```powershell
npm test
```

- `test/parser.test.mjs`：分类、解析、噪声过滤、去重、提示词拼装
- `test/policy.test.mjs`：冷却、优先级、每分钟上限
- `test/collector.test.mjs`：用本地假页面验证「注入 → 监听新增节点 → drain」，
  包含「选择器全打不中时按高频父容器自动认聊天区」

## 隐私

- `browser-profile*/` 是浏览器数据（可能含 cookie），已在 `.gitignore` 里，**不要提交**。
- 采集只发生在你本机，弹幕内容只发给你自己的桌宠，不经过任何第三方服务。
- 语音合成走 Edge 的公开 TTS 接口，只发送要朗读的那句话。

## License

[MIT](./LICENSE)
