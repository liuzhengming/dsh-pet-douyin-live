# dsh-pet-douyin-live

> **旧名 dsh-douyin-live-pet 已废弃，请使用 dsh-pet-douyin-live。**

> 把抖音直播间的弹幕和礼物，变成 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 头顶的气泡，再读出声。
> 装进 DeepSeek Harness 后，**设置页左侧会多一个「抖音直播」**，里面能填直播间、调语音、看对话记录。

不逆向抖音的私有协议，也不碰签名：用一个独立的匿名 Edge 打开直播间网页，读页面上的聊天区，
把新消息攒成一批交给桌宠，让它用自己的人格回一句，再由 Edge TTS 念出来。

```
抖音直播间网页（Edge，匿名，不需要登录）
        │  聊天区新增的 DOM 文本
        ▼
   采集器（页面内）→ 分类/去重/过滤噪声 → 攒批
        │
        ├─ 有 dsh-pet：POST /dsh-pet-7340/chat，用它的口吻回话（气泡同步出现）
        └─ 没有 dsh-pet：降级成播报（只谢礼物、只回应被叫到的名字）
        ▼
   Edge TTS / 系统语音 / 你自己接的语音服务
        ▼
   对话记录（~/.dsh/douyin-live-pet/history.jsonl）
```

## 功能

| 能力 | 说明 |
|---|---|
| 实时采集 | 评论、弹幕、礼物、进场、点赞，延迟约 1 秒 |
| 不需要登录 | 匿名打开直播间就能看到弹幕；个别房间要求登录时才需要 |
| 设置页 | 左侧「抖音直播」：直播间、语音、回话节奏、对话记录 |
| 语音 | Edge TTS（免费）/ 系统语音 / **外接 HTTP 语音服务** |
| 对话记录 | 最近 60 条在设置页可看，全量写在本机 |
| 克制 | 最小间隔、每分钟上限、礼物冷却、小礼物不逐条谢 |
| 抗改版 | 选择器打不中时，按「新增短文本最频繁的容器」自动认聊天区 |
| 只读 | 不发弹幕、不送礼、不点赞 |

## 安装

### 方式一：从 npm 安装（推荐）

```powershell
dsh plugin --profile desktop add dsh-pet-douyin-live
```

装完重启 DeepSeek Harness，**设置 → 左侧「抖音直播」**就会出现在菜单里。

> `--profile desktop` 里的 `desktop` 换成你自己的 profile 名（默认就是 `desktop`）。
> 也可以直接装进全局：`npm i -g dsh-pet-douyin-live`。

### 方式二：从源码链接（改代码时用）

```powershell
git clone git@github.com:liuzhengming/dsh-pet-douyin-live.git
dsh plugin --profile desktop add link:D:\path\to\douyin-live-pet
```

`link:` 安装会直接用仓库目录，改完代码刷新页面就生效，适合调试。

### 方式三：不装插件，命令行跑

```powershell
cd douyin-live-pet
npm install
npm start -- --room 170276491197
```

命令行模式和设置页共用同一套采集/回话/朗读逻辑，只是没有界面。

## 第一次使用

1. 打开 **设置 → 抖音直播**；
2. 在「直播间」里填房间号或直接粘贴 `https://live.douyin.com/<房间号>`，点 **开始监听**；
3. 下方「对话记录」会实时出现弹幕和桌宠的回话。

房间号不知道？命令行跑 `npm run discover` 会列几个正在直播的。
也可以先跑 `npm run anon-check -- --room <房间号>` 确认这个房间匿名能不能看到弹幕。

## 设置页都有什么

| 区块 | 内容 |
|---|---|
| **运行状态** | 是否在监听、桌宠连没连上、已收多少条 / 回了多少次、最近错误 |
| **直播间** | 房间号或链接、开始/停止、「DSH 启动时自动开始」 |
| **语音** | 开关、引擎（Edge / 系统 / 外接 HTTP / 不朗读）、音色、语速、音量、试听 |
| **回话节奏** | 最小间隔、每分钟上限、礼物冷却、响应概率、关键词、忽略的小礼物、是否回应进场/点赞 |
| **对话记录** | 最近 60 条，含时间、观众、弹幕原文、桌宠的回话；可刷新、可清空 |

改任何一项都会立刻存盘，正在监听时下一轮循环就生效，不用重启。

## 关于 dsh-pet：没有它也能跑

**我的选择是不自动安装 dsh-pet**，理由很实际：

- 插件之间互相静默安装，等于替用户做主，还会引出「谁覆盖谁的配置」「版本对不上」这类麻烦；
- dsh-pet 有自己的设置、人格、记忆文件，装不装应该由你决定。

所以这个插件的行为是：

1. 启动时探测 `http://127.0.0.1:52718/dsh-pet-7340/state`；
2. **探测到**：弹幕交给桌宠，用它的人格和记忆回话，气泡同步出现在它头顶；
3. **没探测到**：降级成「播报」——只谢礼物、只回应被叫到的名字，不会假装在聊天；
4. 设置页顶部会直接告诉你「未检测到 dsh-pet」，并给出安装方法。

想让它像人一样聊天，装一个 dsh-pet 就行：

```powershell
dsh plugin --profile desktop add dsh-pet
```

装完重启，回到「抖音直播」页面，状态会变成「桌宠已连接」。

## 语音：三种引擎

| 引擎 | 说明 |
|---|---|
| `edge`（默认） | Edge 的在线 TTS，免费、不用 Key、音质好；断网会自动退回系统语音 |
| `sapi` | Windows 自带语音，完全离线，音质一般 |
| `http` | 接你自己的语音服务，见下 |

外接语音服务只要满足：**POST JSON `{text, voice}`，返回 `audio/*` 音频流**。

```powershell
# 例：本地起一个返回 mp3 的服务，填到设置页的「外接语音服务地址」
POST http://127.0.0.1:9880/tts  {"text":"你好","voice":"zh-CN-XiaoxiaoNeural"}
→ 200 audio/mpeg <二进制>
```

这样 GPT-SoVITS、CosyVoice、豆包、你自己的模型都能接进来。

## 对话记录

- 位置：`~/.dsh/douyin-live-pet/history.jsonl`（一行一条 JSON）
- 设置页显示最近 60 条，文件超过 4000 条时会自动截断到 2000 条
- 只记观众消息和回话，**不记 cookie、不记页面 HTML**
- 清空：设置页「清空」按钮

## 命令行（不装插件也能用）

| 命令 | 作用 |
|---|---|
| `npm start -- --room <房间号>` | 采集 → 桌宠回话 → 朗读 |
| `npm start -- --room <房间号> --dry` | 只打印，不叫桌宠也不出声 |
| `npm start -- --room <房间号> --seconds 90` | 跑固定时长自动收工 |
| `npm run inspect -- --room <房间号>` | 校准：逐行打印采集结果和容器诊断 |
| `npm run discover` | 列几个正在直播的房间号 |
| `npm run anon-check -- --room <房间号>` | 看这个房间匿名能不能看到弹幕 |
| `npm run say -- "在吗"` | 单独试一句：回话 + 朗读 |
| `npm test` | 跑测试（37 项） |

命令行读仓库里的 `config.json`（没有就用默认值），插件读 `~/.dsh/douyin-live-pet/config.json`，两者互不干扰。

## 配置项

插件设置页覆盖了下面这些；命令行模式可以直接改 `config.example.json`：

| 键 | 默认 | 说明 |
|---|---|---|
| `roomId` | 空 | 房间号或链接 |
| `autoStart` | false | DSH 启动时自动开始监听 |
| `pet.enabled` | true | 是否交给 dsh-pet 回话 |
| `pet.baseUrl` | `http://127.0.0.1:52718` | DSH 地址 |
| `pet.petId` / `pet.surface` | `main` / `desktop` | 哪只桌宠、显示在哪端 |
| `reply.minIntervalSec` | 20 | 两次回话最小间隔 |
| `reply.maxPerMinute` | 3 | 每分钟上限 |
| `reply.giftCooldownSec` | 45 | 礼物致谢冷却 |
| `reply.chatProbability` | 0.35 | 普通弹幕的响应概率 |
| `reply.keywords` | 鱼 / 小女仆 / 主播 | 命中优先回 |
| `reply.ignoreGifts` | 小心心 等 | 这些小礼物不逐条谢 |
| `reply.includeEnter` / `includeLike` | false | 是否回应进场、点赞 |
| `tts.engine` | `edge` | `edge` / `sapi` / `http` / `off` |
| `tts.voice` | `zh-CN-XiaoxiaoNeural` | 也可 `zh-CN-YunxiNeural`、`zh-CN-XiaoyiNeural` |
| `tts.endpoint` | 空 | `engine=http` 时的语音服务地址 |
| `capture.profileDir` | `~/.dsh/douyin-live-pet/browser-profile-anon` | 浏览器数据目录 |

## 常见问题

| 现象 | 原因 | 处理 |
|---|---|---|
| 左侧没有「抖音直播」 | 插件没加载或页面没刷新 | 看插件管理器里是否启用；刷新页面；必要时重启 DSH |
| 有入口但页面空白 / 报错 | 客户端 bundle 没被服务 | 重启 DSH；仍不行请带日志提 issue |
| 一条弹幕都没有 | 房间没人说话 | 换人多的房间；`npm run inspect` 看原始输出 |
| 状态显示「未检测到 dsh-pet」 | 没装或没开 | 见上面「关于 dsh-pet」 |
| 没声音 | 没有 ffplay，或 Edge TTS 被墙 | 装 ffmpeg；或把引擎换成 `sapi` |
| 页面显示「聊天功能不可用 / 需先登录」 | 那是**发评论**的限制 | 不影响查看，忽略 |
| 换房间后采不到 | 抖音改版 | `npm run inspect -- --room <新房间号> --html` 看 DOM，改 `src/inpage.mjs` |

## 已知限制

- **只读**：不发送弹幕、不送礼、不点赞。
- **同一时刻只能守一个房间。**
- **依赖网页结构**：抖音改版时 class 名会变，采集器有兜底，真采不到就跑 `inspect` 重新校准。
- **视频区的 canvas 弹幕抓不到**（画在画布上，DOM 里没有文本）；右侧聊天区有同样内容。
- **只在 Windows 上验证过**：`tts.mjs` 的播放与 SAPI 分支是 Windows 的。

## 目录

```
client.js              浏览器半：设置页 UI（settings.section 插槽）
src/plugin.mjs         宿主半：/douyin-live-pet 路由
src/engine.mjs         采集 → 回话 → 朗读 的主循环（插件与 CLI 共用）
src/config.mjs         配置默认值 / 校验 / 读写
src/history.mjs        对话记录
src/reply.mjs          回话来源：桌宠优先，降级播报
src/inpage.mjs         注入页面的采集器
src/capture.mjs        Edge 启动、注入、drain
src/parser.mjs         分类 / 解析 / 去重 / 拼提示词
src/policy.mjs         什么时候该回话
src/pet.mjs            调 dsh-pet 的 /chat
src/tts.mjs            三种语音引擎 + 播放
src/bridge.mjs         命令行入口
src/inspect.mjs        校准；src/discover.mjs 找房间；src/anon-check.mjs 匿名检查
test/                  37 个测试
```

## 开发与测试

```powershell
npm install
npm test
```

- `test/parser.test.mjs`：分类、噪声过滤、去重、提示词
- `test/policy.test.mjs`：冷却、优先级、每分钟上限
- `test/config.test.mjs`：房间号归一、越界夹取、读写往返
- `test/history.test.mjs`：追加、截断、坏行跳过
- `test/collector.test.mjs`：本地假页面验证「注入 → 监听 → drain」，含选择器全不命中时的自校准
- `test/client.test.mjs`：用假的模块加载器跑 `client.js`，验证插槽注册与首帧渲染

## 隐私

- `browser-profile*/` 是浏览器数据（可能含 cookie），已在 `.gitignore` 里。
- 采集只在你本机发生，弹幕只发给你自己的桌宠，不经过第三方服务。
- 语音走 Edge 的公开 TTS 接口，只发送要朗读的那句话；用 `http` 引擎时发给你自己的服务。

## License

[MIT](./LICENSE)
