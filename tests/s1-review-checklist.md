# S1 评审与验收清单（明镜 · QA）

依据：GOAL.md 阶段 1 验收、CONSTRAINTS.md 红线、cordis-plugin-development 技能
（SKILL.md / references/host-plugin.md / ui-plugin.md / verification.md）。
基线证据见 `docs/verification-s1.md` 与 `tests/baseline/`。
状态标记：⬜ 待测 / ✅ 通过 / ❌ 缺陷（附缺陷单号）/ ⚠️ 有观察项。
更新：2026-11-12 11:3x —— 代码评审与命令实测完成；GUI 实测（A2–A4）待浏览器面板。

## 一、代码评审 —— 磐石（Host 半）

### 1. bundle 骨架（对照 host-plugin.md 展示清单）
- ✅ R-H1 `package.json`：`@local/dsh-music` 0.1.0、private、type module、exports 含
  `.`/`./client`/`./locale/*.json`/`./icon`；files 覆盖全部运行时文件；dsh.bundle.patch 正确。
- ✅ R-H2 `cordis.patch.yml`：单 insert 行 id=dsh-music、name 与包名一致；安装只经
  install_bundle（profile 改动核验见 R5）。
- ✅ R-H3 locale：zh「本地音乐」+ en「Local music」meta.title/description 有意义，
  8 语齐全，无模板残留；英文 sentence case。
- ✅ R-H4 `icon.svg`：原创双音符图标 716B、合法 SVG、包内相对路径、无外链（GUI 渲染待 A4）。
- ✅ R-H5 导出形式单一（apply+inject=['webServer']）；路由经 ctx.effect 注册并返回
  disposers；library.dispose 终止子进程；异步首扫不阻塞激活。

### 2. 曲库扫描
- ✅ R-H6 三目录齐全；缺失目录 realpath catch→continue 优雅跳过（scan-test 实证 dsh-music 跳过）。
- ✅ R-H7 五格式扩展名 toLowerCase 匹配；manifest.json 不入库（55 m4a 全量）。
- ✅ R-H8 ffprobe 标签（大小写归一）+attached_pic 封面探测；失败回退文件名解析；
  《光輝歲月》302.834649s/命運派對/封面 实证。
- ✅ R-H9 扫描只读：spotify-liked 56 文件快照 diff 为空（红线 R2）。
- ✅ R-H10 总数 61 = spotify-liked 55 + apple-music 6（scan-test + 活体 API 双证）；GUI 展示待 A2。

### 3. 播放状态服务 + 音频路由
- ✅ R-H11 播放状态机代码评审通过；playback GET/POST 往返实测通过（GUI 操作待 A3）。
- ✅ R-H12 Range：200/206/416、Content-Range、Accept-Ranges、后缀 Range、单字节 0-0、
  多 Range 按 RFC 忽略→200、MIME audio/mp4 —— 20/20 脚本 + 明镜补充用例全过。
- ✅ R-H13 路由安全：id 仅经内存索引（ID_RE 16hex）+ realpath 必须落在 roots 内双防线；
  6 种穿越变体 + 大写/短/带空格 id 全 4xx；不拼接用户输入；服务仅监听 127.0.0.1。
- ✅ R-H14 S1 无下载/同步代码；grep yt-dlp|spotify-sync 零命中；无管线进程。
- ✅ R-H15 零外部网络：grep fetch(|http 模块零命中（S1 全本地）。
- ✅ R-H16 grep refresh_token|spotify-sync 配置路径零命中；凭据 stat 与基线一致。
- ✅ R-H17 数据只写 ~/.dsh/dsh-music/（library-cache.json + cache/covers/，2.9MB 实证）；
  原子写（tmp+rename）；封面缓存按 id+mtime 失效。

## 二、代码评审 —— 织音（Client 半）

- ✅ R-C1 注册契约逐一对照真实源码核实：`sidebar.panellist` {id,order,label:()=>t,locale}
  （ui-sidebar/contract/slots.ts：owner props {size,active} ✓）；`main` {key:'music',locale,inject}；
  `shell.overlay` {id:'dsh-music.mini-player'}；`inject.hooks`→`use<Name>` selector hook
  （ui-slots/src/index.ts PropsHooks ✓）；范式与官方 ui-plugin-manager 完全一致；
  ctx.layout.selectPanel 存在（ui-layout/service.ts）。
- ✅ R-C2 无 Harness Client 包 import（grep 0 命中）；React 来自浏览器模块表。
- ✅ R-C3 硬编码颜色 grep 0 命中；21 个 --dsw-alias-* token 全部存在于 design-platform.css。
- ✅ R-C4 locale zh/en 各 60 键、t() 引用 55 键、缺键 0、键集一致；
  ⚠️ 错误文案绕过 locale → 缺陷 S1-001（次要）。
- ✅ R-C5 曲库列表代码评审通过：封面/歌手/标题、搜索、按歌手/专辑分组、播放全部/随机、
  骨架屏/空态/错误态齐全（GUI 待 A2）。
- ✅ R-C6 播放控制代码评审通过：单例 Audio 引擎独立于面板生命周期、播放/暂停/上下首/
  拖动（指针+键盘）/音量/静音/队列跳转/随机/三态循环/MediaSession（GUI 待 A3）。
- ✅ R-C7 迷你条挂 shell.overlay，openNow→selectPanel('music')（GUI 待 A3）。
- ✅ R-C8 React.createElement 文本转义；无 innerHTML/dangerouslySetInnerHTML（grep 0）；
  console 无崩溃待 GUI 确认。
- ✅ R-C9 图标原创：bundle 双音符 SVG + client 手绘 path 图标集（currentColor）；渲染待 A4。
- ⬜ R-C10 简繁搜索行为待 GUI 记录 → 缺陷 S1-002（次要，建议简繁归一）。

## 三、验收实测（GOAL.md S1）

- ✅ A1 安装：磐石提供 install_bundle 完整返回 `application: applied`、warnings:[]、exitCode 0；
  明镜交叉核验：profile package.json 新增 link 依赖 + bundles 数组含 @local/dsh-music、
  node_modules/@local/dsh-music 符号链接指向项目 bundle、活体路由 200。
  （双方会话均无 cordis_inspect 工具；以 profile 只读文件 + 活体 HTTP + GUI 替代核验，
  与技能 verification.md 的降级路径一致。）
- ⬜ A2 曲库 GUI：待用户打开明镜浏览器面板加载 http://127.0.0.1:53079 刷新后实测。
- ⬜ A3 播放 GUI：同上（播放/暂停/拖动/切歌/音量 + 迷你条跨会话页）。
- ⬜ A4 明暗主题 GUI：同上（当前 preference=light，需用户切换 dark）。
- 🔄 A5 证据归档：本文件 + docs/verification-s1.md 持续更新。

## 四、红线抽查

- ✅ R1 凭据未读/未动：stat 与基线一致（600/131B/mtime=1794284632）；代码零引用。
- ✅ R2 spotify-liked 零改动：56 文件快照 diff 为空。
- ✅ R3 S1 无下载；代码写路径仅 ~/.dsh/dsh-music/（storage.js 评审 + 目录实证）。
- ✅ R4 无并发管线：无管线代码、无 yt-dlp/spotify-sync 进程。
- ✅ R5 profile 改动归属：package.json 仅 install_bundle 合法改动（11:25:38）✓；
  cordis.patch.yml 的 mega-codex 删除经用户确认为本人设置变更（Chief 12:1x 销案），
  非 Bot 手写，红线无违反。用户 patch 无 dsh-music 行 ✓。
- ✅ R6 仅本地数据：零外部网络调用；数据目录实证。
- ✅ R7 无替代服务器/mock 壳/预览 HTML；验证走现有 URL（127.0.0.1:53079，仅 loopback）。

## 五、缺陷流程

缺陷单 `tests/defects/S1-NNN.md`：
- S1-001（次要，织音）错误文案绕过 locale —— 不阻塞，S2 顺带修。
- S1-002（次要，织音）搜索无简繁归一 —— 不阻塞，S2/S4 修。
- S1-003（次要，磐石）playback.trackId 未校验存在性 —— S3 落历史前处理。
阻塞级缺陷：无。GUI 实测如发现新问题另行立单。