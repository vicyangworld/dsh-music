# ECHO / dsh-music 客户端

`index.js` 是给 Harness 加载的自包含生成产物。请编辑仓库中的 `src/client/`，然后在仓库根目录运行 `npm ci && npm run build`。不要直接修改生成文件。

## 加载与依赖

客户端通过 `window.__ModuleLoader__.load` 注册工厂，模块 ID 为 `@vicyangorg/dsh-music`，与包名一致。工厂只从宿主模块表取得 `react` 和可用的 `react-dom` portal；发布包不捆绑另一份 React，也不导入 Harness 私有客户端包。

开发依赖中的 React、ReactDOM 用于独立预览；esbuild 将源码、生命规则、Three.js 和 CSS 合成单个 `bundle/client/index.js`。宿主安装这个产物时无需运行构建。Three.js 许可包含在包内 `docs/THIRD_PARTY.md`。

## 渲染面

| 插槽 | 注册键 | 内容 |
|---|---|---|
| `sidebar.panellist` | `music` | 宿主的音乐入口 |
| `main` | `music` | 相处、音乐、记忆；更多菜单保留策展、推荐、历史和设置 |
| `shell.overlay` | `dsh-music.mini-player` | 跨面板音灵伴生窗，可收拢、拖动、隐藏和控制播放 |

`inject.hooks` 中的 store 提供不可变 `getSnapshot/subscribe` 契约，Harness 生成对应的 `usePlayer/useUi` 等 selector hooks。播放器在 `apply()` 中单例创建，切换主面板不会停止播放。卸载时先停止播放器并将最后一段观察交给待发送队列，再释放生命客户端。

## 文件职责

| 源码 | 职责 |
|---|---|
| `src/client/index.js` | Harness 插槽、音乐服务、曲库和原有音乐视图 |
| `src/client/echo/ui.js`、`ui.css` | 音灵主舞台、招呼、记忆、时间线、形态比较和伴生窗 |
| `src/client/echo/creature.js`、`creature.css` | 三种程序化 SVG 身体结构、动作和身体标记 |
| `src/client/echo/body-renderer.js`、`body-motion.js` | 朏朏三维身体、骨架/蒙皮、成长插值、接地、局部连续运动与可验证的模型轨迹执行 |
| `src/client/echo/motion-provider.js` | 学习型运动服务状态、每次请求的取消与模型结果校验；无内置模型权重 |
| `src/client/echo/audio.js` | 观察本播放器的有效播放区间与可用音频特征 |
| `src/client/echo/service.js` | 生命 API、持久待发送队列、重试及错误反馈 |
| `bundle/shared/life-core.js` | 浏览器和服务端共享的确定性成长规则 |
| `bundle/shared/body-core.js`、`motion-core.js` | 统一身体描述、成长版本与运动轨迹协议 |
| `src/preview/entry.jsx` | 独立预览的宿主适配器，加载同一个生成客户端 |

## 同源 API

宿主路径按 `document.baseURI` 解析，保留非根路径挂载支持。

- `GET /dsh-music/api/life`：当前生命、旧形态、身体版本与成长资格。
- `POST /dsh-music/api/life/events`：提交一个经验证的经历。
- `GET /dsh-music/api/life/export`：导出已保存的版本化生命档案。
- `GET/POST /dsh-music/api/life/development`：连接状态、符合条件的模型成长提案。
- `GET /dsh-music/api/life/motion`、`POST /dsh-music/api/life/motion/generate`：学习型运动服务状态与当前身体的连续运动。
- 原有 library、audio、cover、history、lyrics、reco 等接口保持可用。

失败的经历不会显示成已完成成长。网络暂不可用时保留本机队列；无法写入本机时明确显示仅保留在当前页面。单条无效经历单独保留，可查看原因、重试和导出。待发送/未接受的经历与服务端正式档案分开导出。

## 当前视觉与验证边界

alpha.4 的当前身体为朏朏三维工程样机，旧版形态/历史快照和 WebGL 不可用环境保留 SVG 回退。动效支持 `prefers-reduced-motion`，交互与记忆可通过键盘操作。该版本没有包内运动权重，默认动作来源为 procedural；只有真实服务返回并通过验证的轨迹正在执行时才为 learned。模型状态和协议见 `../docs/ECHO_MOTION.md`。目前只支持一种身体结构，没有无限拓扑生成或真实用户个体在线训练。

`npm run preview` 使用真实客户端和生命服务、独立临时数据目录及三段原创合成试听，不会扫描用户曲库。DOM 流程测试、规则测试和 SVG 静态检查不代替 Harness 实机上的布局、音频输出和性能验收。完整行为和容量限制见 [ECHO 说明](../docs/ECHO.md)。
