# dsh-music

在 DeepSeek Harness 里听本地音乐，和一个逐渐长出自己模样的数字生命相处。**0.8.0-alpha.1** 是 ECHO 原型，基于 0.7.0 本地音乐工作台继续开发；曲库播放、逐句歌词、歌手页、反信息茧房推荐、喜欢才入库、可选 Spotify 收藏同步和策展功能继续保留。

## ECHO 数字生命原型

每个生命从独立种子开始，拥有稳定的初生身份。本插件内播放本地曲库时，真实声音特征逐渐改变它的比例、曲面、折叠和材质。你可以教它一个敲击招呼、留下一段共同记忆、回看外形变化；离开或少听音乐不会扣分或退化。

当前提供 `fold`、`shell`、`ribbon` 三种结构语法，并在各自范围内连续变化。成长来自版本化规则引擎，不是 LLM 人格生成或无限物种生成。声音特征来自浏览器本地 FFT 的近似分析，不是情绪诊断；特征不可用时只记有效播放时长。「介绍一首歌」只记录主动分享，不会算作已经听过，也没有外部音乐平台自动收听接入。

生命在本机保存，可在「记忆」页面导出 JSON；当前没有导入功能。容量、保存说明、独立预览与开发接口见 [ECHO 说明](docs/ECHO.md)。

## 音乐工作台

从更多菜单打开音乐策展台，可使用智能歌单、私人电台、音乐时光机、音乐考古、每日盲盒。使用 `⌘K` 或 `Ctrl+K` 搜索和执行 `/playlist`、`/radio`、`/history`、`/find`、`/daily`。策展使用本地曲库、媒体标签、喜欢及收听记录。歌单存于当前前端，删除歌单不影响歌曲文件。

本机可选择使用 Harness 中已配置的模型来理解输入指令。配置 `curationProvider` 与 `curationModel` 后，策展台会显示可选开关。模型只收到输入的指令。

## 功能

- **曲库**：扫描 `~/Music/dsh-music`、`~/Music/spotify-liked`、`~/Music/Music/Media.localized`（m4a/opus/mp3/flac/wav），读内嵌标题/歌手/专辑/时长/封面；支持搜索、按歌手专辑分组、三态曲库视图。
- **播放**：播放/暂停、上下首、拖动进度（HTTP Range）、音量、单曲/顺序/随机、队列；跨面板音灵伴生窗控制同一队列，可收拢身体、拖动和隐藏（仅在 DSH 应用内）。
- **歌词与歌手**：内嵌 → LRCLIB → 网页兜底；歌手简介/动态/逸闻/相似歌手，均注明来源与日期。
- **推荐**：基于收听历史的传统算法（零 LLM），今日/同歌手/新风格三栏，探索轴轮换避免信息茧房；推荐候选先经 MusicBrainz 核实再下载。
- **喜欢才入库**：在线试听一律为临时缓存（不入库、不改曲库）；点 ♥ 才下载到 `~/Music/dsh-music/` 并入库。Spotify 取消收藏不会删除本地文件。
- **音乐来源引导（保留原功能）**：原创蓝色大肥鱼 Logo、口味多选（流派/语言）、曲库选择（用已有曲库 / 默认 starter 曲库）；口味作为推荐软偏置（命中优先、不锁死）。
- **默认 starter 曲库（0.3）**：4 首公有领域（Public domain）古典录音，逐首经 Wikimedia Commons 元数据复核许可后串行下载为 128k AAC，署名（来源 URL / 许可 / 作者）随曲目留档；网络失败自动跳过，不阻塞进入推荐。
- **社区（0.3 设计稿）**：opt-in、无自建后端、不上传本地数据；分享卡片与分享码歌单方案见仓库 `docs/community-design.md`。

## 安装

插件品牌名是 **dsh-music**，npm 包名是 **`@vicyangorg/dsh-music`**（原名 `dsh-music` 被 2026-08-19 的占位包占用；GitHub 仓库仍是 vicyangworld/dsh-music）。client 工厂 id 与包名一致，安装后插件行/面板照常出现。

1. 安装插件包：在 DSH 插件市场安装，或用 `plugin_manager` 安装本包（目录、`.tgz` 或 `link:` 源码目录）。
   ```text
   plugin_manager(install_bundle, target: "link:/绝对路径/dsh-music/bundle")
   ```
   也支持本地构建的 tgz：`target: "/path/to/vicyangorg-dsh-music-0.8.0-alpha.1.tgz"`。本 README 不代表该 alpha 已在插件市场或 npm 发布。
2. 刷新 DSH 页面，左侧栏出现「音乐」面板图标，点开即用。
3. 可选：安装 `yt-dlp` 与 `ffmpeg`（macOS: `brew install yt-dlp ffmpeg`），用于在线试听与「喜欢才入库」；不装也能播放本地曲库。

从源码工作时，先在仓库根目录执行 `npm ci` 和 `npm run build`，再安装 `bundle/`。前端源码位于 `src/client/`；`bundle/client/index.js` 是生成文件，修改源码后需要重新构建，再刷新或重新启用插件。Harness 提供 React，插件产物不捆绑第二份 React。

### 独立预览

在完整源码仓库的根目录执行以下命令；仅下载 npm 插件包时不包含这些开发脚本。

```bash
npm ci
npm run build
npm run preview
```

访问 `http://127.0.0.1:4173`。预览只提供三段原创合成试听，不扫描用户曲库、不连接音乐平台。预览使用独立数据目录，终端会显示具体路径；可用 `npm run preview -- --data-dir /绝对路径/echo-preview-data` 指定专用目录。

## 快速开始

1. 打开左侧栏「音乐」先与音灵见面；从更多菜单的「音乐来源设置」选口味、选曲库，也可回到音乐页直接使用已有曲库。
2. 曲库为空时，直接搜歌手或歌名 —— 在线结果可试听（临时缓存，不入库）。
3. 听到喜欢的点 ♥ —— 下载入库，之后就在曲库里。
4. 曲库工具栏的循环按钮切换「单曲 / 顺序 / 随机」；底部播放器可拖动进度，伴生窗可收拢、隐藏和再次显示。

## 可选依赖

- `yt-dlp` + `ffmpeg`：在线试听、喜欢入库的下载音源（上限 YT Music ~128k AAC；不引入盗版音源）。
- `spotify-sync` CLI：一键同步 Spotify 收藏（检测不到时按钮置灰，不影响其他功能；插件只调用 CLI，不接触凭据文件）。

## 数据位置

- 收听历史、缓存、喜欢、推荐记录、onboarding 状态：`~/.dsh/dsh-music/`
- ECHO 生命档案：`~/.dsh/dsh-music/echo-life.json`；配置 `dataDir` 时使用对应目录。保存后可导出，目前不提供导入。
- 喜欢入库与 starter 曲目：`~/Music/dsh-music/`
- 默认扫描曲库：`~/Music/dsh-music`、`~/Music/spotify-liked`、`~/Music/Music/Media.localized`（欢迎页可追加自定义目录，配置 `directories` 也可自定义）

## 隐私与已知限制

- 无遥测、无自建后端。在线请求用于搜索、歌手页、歌词兜底、推荐核实、下载，以及可选的模型指令理解。策展只向模型发送已输入的指令。
- 「跨应用置顶」在 Web 插件里不可实现：悬浮标只在 DSH 应用内位于全局顶层，遮挡其他应用时不生效（不做原生伴侣窗口）。
- 在线试听缓存有上限（LRU 30 首），清空不影响曲库。
- ECHO 原型最多保存 100,000 条已接受事件、64 段共同记忆、96 个时间线节点；存档最大 64 MiB。旧的普通时间线节点会精简，初生节点与共同记忆保留；去重标识不会过期。达到事件或文件容量上限后不再接受新事件，已有档案仍可查看、导出。

## 维护者发布

打包、GitHub Release 与 awesome 列表 PR 步骤见仓库 [`docs/publishing.md`](https://github.com/vicyangworld/dsh-music/blob/main/docs/publishing.md)。

## 更多

完整功能说明、隐私与已知限制见 [docs/DETAIL.md](docs/DETAIL.md)。
