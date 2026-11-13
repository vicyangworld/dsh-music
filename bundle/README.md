# dsh-music

在 DeepSeek Harness 里听本地音乐：曲库播放、逐句歌词、歌手页、按收听历史的反信息茧房推荐、喜欢才入库、可选 Spotify 收藏同步。界面中文、跟随明暗主题，数据只存本机。

## 功能

- **曲库**：扫描 `~/Music/dsh-music`、`~/Music/spotify-liked`、`~/Music/Music/Media.localized`（m4a/opus/mp3/flac/wav），读内嵌标题/歌手/专辑/时长/封面；支持搜索、按歌手专辑分组、三态曲库视图。
- **播放**：播放/暂停、上下首、拖动进度（HTTP Range）、音量、单曲/顺序/随机、队列；迷你播放条常驻，可收起成悬浮标（DSH 应用内全局顶层，切换页面不被遮挡）。
- **歌词与歌手**：内嵌 → LRCLIB → 网页兜底；歌手简介/动态/逸闻/相似歌手，均注明来源与日期。
- **推荐**：基于收听历史的传统算法（零 LLM），今日/同歌手/新风格三栏，探索轴轮换避免信息茧房；推荐候选先经 MusicBrainz 核实再下载。
- **喜欢才入库**：在线试听一律为临时缓存（不入库、不改曲库）；点 ♥ 才下载到 `~/Music/dsh-music/` 并入库。Spotify 取消收藏不会删除本地文件。
- **首启欢迎页（0.3）**：原创蓝色大肥鱼 Logo、口味多选（流派/语言）、曲库选择（用已有曲库 / 默认 starter 曲库）；口味作为推荐软偏置（命中优先、不锁死）。
- **默认 starter 曲库（0.3）**：4 首公有领域（Public domain）古典录音，逐首经 Wikimedia Commons 元数据复核许可后串行下载为 128k AAC，署名（来源 URL / 许可 / 作者）随曲目留档；网络失败自动跳过，不阻塞进入推荐。
- **社区（0.3 设计稿）**：opt-in、无自建后端、不上传本地数据；分享卡片与分享码歌单方案见仓库 `docs/community-design.md`。

## 安装

插件品牌名是 **dsh-music**，npm 包名是 **`@dshbottest/dsh-music`**（原名 `dsh-music` 被 2026-08-19 的占位包占用；GitHub 仓库仍是 vicyangworld/dsh-music）。client 工厂 id 与包名一致，安装后插件行/面板照常出现。

1. 安装插件包：在 DSH 插件市场安装，或用 `plugin_manager` 安装本包（目录、`.tgz` 或 `link:` 源码目录）。
   ```text
   plugin_manager(install_bundle, target: "@dshbottest/dsh-music@0.3.0")
   ```
   也支持本地 tgz：`target: "/path/to/dshbottest-dsh-music-0.3.0.tgz"`。
2. 刷新 DSH 页面，左侧栏出现「音乐」面板图标，点开即用。
3. 可选：安装 `yt-dlp` 与 `ffmpeg`（macOS: `brew install yt-dlp ffmpeg`），用于在线试听与「喜欢才入库」；不装也能播放本地曲库。

从源码工作：`plugin_manager(install_bundle, target: "link:/path/to/dsh-music/bundle")`，改动后重新启用插件即可加载新代码。

## 快速开始

1. 打开左侧栏「音乐」。首次启动（曲库为空）会进入欢迎页：选口味 → 选曲库 → 用默认 starter 或直接进入推荐。
2. 曲库为空时，直接搜歌手或歌名 —— 在线结果可试听（临时缓存，不入库）。
3. 听到喜欢的点 ♥ —— 下载入库，之后就在曲库里。
4. 工具栏的循环按钮切换「单曲 / 顺序 / 随机」；迷你播放条可拖动进度、收起、关闭（工具栏可再显示）。

## 可选依赖

- `yt-dlp` + `ffmpeg`：在线试听、喜欢入库的下载音源（上限 YT Music ~128k AAC；不引入盗版音源）。
- `spotify-sync` CLI：一键同步 Spotify 收藏（检测不到时按钮置灰，不影响其他功能；插件只调用 CLI，不接触凭据文件）。

## 数据位置（仅本机，不上传）

- 收听历史、缓存、喜欢、推荐记录、onboarding 状态：`~/.dsh/dsh-music/`
- 喜欢入库与 starter 曲目：`~/Music/dsh-music/`
- 默认扫描曲库：`~/Music/dsh-music`、`~/Music/spotify-liked`、`~/Music/Music/Media.localized`（欢迎页可追加自定义目录，配置 `directories` 也可自定义）

## 隐私与已知限制

- 无遥测、无账号、无自建后端；历史/缓存/路径/凭据永不离开本机。在线请求只发生在：搜索、歌手页、歌词兜底、推荐核实与下载。
- 「跨应用置顶」在 Web 插件里不可实现：悬浮标只在 DSH 应用内位于全局顶层，遮挡其他应用时不生效（不做原生伴侣窗口）。
- 在线试听缓存有上限（LRU 30 首），清空不影响曲库。

## 维护者发布

打包、GitHub Release 与 awesome 列表 PR 步骤见仓库 [`docs/publishing.md`](https://github.com/vicyangworld/dsh-music/blob/main/docs/publishing.md)。

## 更多

完整功能说明、隐私与已知限制见 [docs/DETAIL.md](docs/DETAIL.md)。
