# dsh-music Client 半（织音）

单文件浏览器产物 `index.js`，无构建步骤。通过 `window.__ModuleLoader__.load` 注册懒工厂，
id = `@dshbottest/dsh-music`（须与 bundle 包名 `name` 完全一致）。React 来自浏览器模块表，不安装重复 React，
不 import 任何 Harness Client 包（遵守 cordis-plugin-development 的 ui-plugin/practices 规范）。

## 渲染面（已对照真实源码契约核实）

| 插槽 | 类型 | 用途 | 关键注册参数 |
|---|---|---|---|
| `sidebar.panellist` | list | 左侧栏"音乐"图标 | `{id:'music', order:30, label:()=>t('panel')}`；组件收 owner props `{size, active}` |
| `main` | keyed | 音乐面板（曲库/推荐/正在播放） | `{key:'music', locale:'dshMusic'}` |
| `shell.overlay` | list | 迷你播放条，跨面板常驻 | `{id:'dsh-music.mini-player'}`；overlay 层 click-through，条目自带 pointer-events |

依据：`ui-layout/src/client/index.ts`（插槽声明）、`ui-sidebar/src/client/contract/slots.ts`
（panellist 元数据 `{id, order, label}`）、`ui-plugin-manager/src/client/index.ts`（注册范式）、
`AppFrame.tsx`（main 只渲染当前 key → 播放器必须独立于面板生命周期；shell.overlay 无条件挂载）。

## 架构

- **播放器单例**（`createPlayer`）：在 `apply()` 中创建、`ctx.effect` 持有 dispose。
  HTMLAudioElement + 不可变快照 store（getSnapshot/subscribe）。面板切走时组件卸载但引擎不停，
  迷你条继续控制。支持播放/暂停、上下首、拖动进度、音量/静音、随机、三态循环、队列跳转、
  MediaSession（系统媒体键，try/catch 降级）。音量/静音/随机/循环偏好存 localStorage。
- **曲库 store**（`createLibrary`）：fetch Host 路由，status: idle/loading/ready/error，防并发。
- **视图状态 store**（`ui`）：`{view:'library'|'reco'|'now'}`，面板与迷你条共享；
  迷你条点击 → `openView('now') + ctx.layout.selectPanel('music')`。
- 组件经注册项 `inject.hooks` 拿到 `usePlayer/useLibrary/useUi` selector hook（框架绑定），
  只选原始值/稳定引用，避免 timeupdate（~4Hz）引发整列表重渲染。

## Host 契约（S1，与磐石约定）

同源 HTTP（JSON 里是根绝对路径；Client 按宿主 boot graph 约定**去掉开头 `/` 后
`new URL(rel, document.baseURI)`** 解析，兼容非根挂载——与磐石约定的实现细化）：
- `GET /dsh-music/api/library` → `{tracks:[{id,title,artist,album,duration,format,source,audioUrl,coverUrl}],scannedAt}`
- `POST /dsh-music/api/rescan` → 同结构
- `GET /dsh-music/audio/<id>` → Range 音频流（206/Accept-Ranges/Content-Type）
- `GET /dsh-music/cover/<id>` → 封面图片或 404
- 非 2xx：`{error:"中文原因"}`，UI 原样展示。

## 主题与文案

- 全部颜色走 `--dsw-alias-*` token（21 个，已逐一对照 ui-theme design-platform.css 验证存在）；
  无硬编码颜色，明暗主题自动跟随。图标为原创手绘 SVG path（currentColor）。
- 文案全量走 Client locale：命名空间 `dshMusic`，zh/en 各 60 键，已脚本校验无缺键。
- 动效：均衡器跳动、迷你条入场、hover/active 反馈、骨架屏；`prefers-reduced-motion` 全降级。
- 滚动条自绘（token 色），列表/正在播放两区一致。

## 阶段边界

- S1（本文件当前范围）：曲库列表（搜索/按歌手/按专辑分组/播放全部/随机播放）、播放控制、
  正在播放视图（大封面+进度+队列）、迷你播放条、推荐视图的诚实空状态（S3 上线说明）。
- S2 接入：歌词滚动视图、歌手卡片抽屉（拾词的数据就绪后在 NowPlaying/曲库行扩展）。
- S3 接入：推荐列表（相近/探索标注+理由）、下载队列、Spotify 同步按钮、历史视图。

## 静态验证记录（2026-11-12）

- `node --check bundle/client/index.js` → SYNTAX OK
- locale 键覆盖脚本：used 55 / zh 60 / en 60，缺键 0，zh/en 键集一致
- CSS 硬编码颜色扫描：0；使用的 21 个 token 全部存在于 design-platform.css
- 组件引用审计：所有 `h(Icon*/Component)` 均有定义

GUI 实测待磐石的 Host 半 + manifest 就绪、`install_bundle` applied 后进行（证据交明镜/Chief）。
