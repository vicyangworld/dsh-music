# ECHO P1 诉求梳理 v0.1

状态：待用户一轮决策（见 §4）。决策后写 P1 group_goal 并派发。
来源：用户 2026-11-20 晚 8 点诉求（群消息 m00307/m00312）；P0 已 complete（docs/verification-p0.md v1.1）。
事实核实日期：2026-11-20（Chief 本机 ls/grep/读码 + api.github.com 星数实测）。

## 0. 目标演进
P0（已交付）：插件内共鸣卵→孵化→互动→可见变化→重启保留，五约束+红线全绿。
P1（本轮）：把 ECHO 从「插件里的一个面板」升级为「mac 桌面上活着的音乐伴生体」：
dsh-music 插件**原地升级**为 ECHO 形式（不新建插件/项目目录），桌面灵宠上桌面，
播放器三件套（连续播放/控制/歌词）、主动推荐、喜欢列表同步（先自用）、历史统计、视觉高级化。
硬约束：mac only 先行；先自用；原地合并不另起炉灶；P0 全部红线继承。

## 1. 现状事实（已核实）
- 双插件并存：profile 依赖 `@vicyangorg/dsh-echo@link:/Users/yangwenkui/Projects/dsh-music/bundle`
  与 `@vicyangorg/dsh-music@link:/Users/yangwenkui/DeepseekSessions/dsh-music/bundle`。
- ECHO 仓库 /Users/yangwenkui/Projects/dsh-music **不是 git 仓库**（合并前建议 init+首提交存档 P0 基线）。
- ECHO 数据目录 ~/.dsh/echo（用户不想要）；旧插件数据 ~/.dsh/dsh-music/：
  history.jsonl（trackId/artist/title/timestamp/completion/skipped/reason）、likes.json（v2，artist::title+likedAt）、
  reco-history.json、reco-state.json、library-cache.json、downloads.json、onboarding.json。
- 旧插件宿主 ~/DeepseekSessions/dsh-music/bundle/host/ 已有：playback.js、playlist-import.js、likes.js、
  history.js、reco/{discover,diversity,images,index,llm,mb,pools,quota,style,verify}.js、sync.js、search.js、
  download.js、metadata/、media-core.js、preview.js、starter.js、t2s.js、tags.js、onboarding.js、routes.js、main.js；
  client 已有 historyStats 与 lyric UI。→ **4/5/6/7 多数是升级复用，不是从零建。**
  - sync.js：Spotify 一键同步仅调 spotify-sync CLI（凭据经 CLI，不读 refresh_token；CLI 缺失=可选功能中文引导；同步后自动重扫）。
  - playlist-import.js：QQ音乐/网易云**公开歌单链接仅元数据导入**（短链解析→歌单元数据→简繁归一 artist::title 本地匹配→
    缺口走现有下载管线串行；逻辑参考 GoMusic MIT 重写 ESM、GPL 零引用；音频只走 YT Music 管线写 ~/Music/dsh-music）。
- ~/Music/spotify-liked 已落盘 66 首 m4a（Spotify 喜欢已本地化）。
- 桌宠原型 ~/Downloads/dsh-music/scripts/desktop-pet-proto/{PetWindow.swift,echo-pet-helper,launch.mjs,pet.html}：
  已验跨应用悬浮/透明/quit 干净回收/resident≈73MB。ECHO bundle/host/companion.js 生命周期就绪
  （config.companionBinary；NO_HELPER→503 预期降级）。docs/ECHO_伴生helper与P0兜底口径_v0.1.md：
  网页 overlay 不能跨应用悬浮；复用打包 Electron 路径已证伪；helper WKWebView 加载同一舞台、不新增第二套生命状态。

## 2. 八点逐条梳理
### ① 桌面灵宠上桌面
现状：只在插件面板内。差距：缺原生悬浮窗载体。
方案：原型入仓（scripts/desktop-pet-proto → 仓库内），companion.js 接 companionBinary；
helper WKWebView 加载同一 stage-ui 舞台（只读快照，零第二套状态）；窗口位置/置顶/穿透可选持久化；
quit→SIGTERM→SIGKILL 回收已验。mac only。交互打磨参考 BongoCat（24.7k★）。
归属：纳音（生命周期/打包）+绘灵（舞台适配小窗）。红线：AR-04 resident 采样在伴生启用后补 PERF-01/02。
### ② dsh-music 原地升级为 ECHO（不新建目录）
现状：双 entry 并存、数据双目录。方案：以 ~/DeepseekSessions/dsh-music/bundle 为合并落点（保留包名 dsh-music 与
/dsh-music/api/* 路由），把 ECHO 的 engine/host/client/stage-ui 并入；dsh-echo entry 退役；
数据统一 ~/.dsh/dsh-music/：~/.dsh/echo 的 seedRecord+密封日志经 Path A 回放迁移（stateHash 校验），
旧 history/likes 映射为输入层事件/印记（不伪造听歌：旧 history 有 completion/skipped 真实字段，可按阈值归一）。
合并前 git init 存档 P0 基线。归属：纳音主导+灵枢迁移接缝+守正回归（P0 35 断言+live 29 全复跑）。
### ③ 先只做 mac
确认。Swift helper 天然 mac；Win/Linux 后置不排期。
### ④ 列表连续播放/播放控制/歌词
现状：旧 playback.js+client lyric UI 存在；ECHO client 只有喂养胶囊。
方案：队列模型（列表循环/单曲/随机）+传输控制（play/pause/prev/next/seek/volume）+歌词
（本地 .lrc/内嵌优先、时间轴滚动；桌面歌词可选走 helper 窗，参考 SPlayer/AlgerMusicPlayer）；
播放完成≥30s 有效投喂规则不变，队列连播自然产生连续有效投喂。归属：纳音+绘灵。
### ⑤ 音乐主动推荐+主动重新推荐
现状：旧 reco/ 模块（discover/diversity/pools/quota/style/llm）存在。
方案：升级为 ECHO 证据链——确定性打分（心境印记/共鸣时段/近期未播/多样性）读引擎只读快照；
AI 重排可选、走知微预算（20/日、3/分、L2 降级）；新增主动通道 recommend：独立开关、免打扰 22:00–08:00 继承、
日限按阶段；重新推荐=本轮排除刷新+可解释理由（引真实证据，不编造历史）。归属：灵枢打分+知微通道+绘灵卡片。
### ⑥ 喜欢列表同步（先自用：QQ/Spotify/网易云）
现状：Spotify 合规链路已活（sync.js→spotify-sync CLI；66 首已落盘）；QQ/网易已有公开歌单元数据导入。
决策点（§4-Q1）：A 沿用并扩展现有口径到「我喜欢」歌单链接（推荐，零红线变化）；
B 自用灰区：读本地客户端缓存/导出文件（需逐平台可行性核实）；C 非官方 API/cookie 直读喜欢列表（触 P0 红线，需用户显式改红线记录）。
归属：纳音。
### ⑦ 历史统计
现状：旧 history.jsonl+historyStats 存在；ECHO 输入层 events.jsonl 是播放真相、引擎密封日志是成长真相。
方案：统计读输入层（时长/Top 曲目/连续天数/时段分布/完成率），本地可导出；档案页图表化，
**不做经验条/进度条式成长展示**（视觉红线）。归属：纳音聚合+绘灵图表+守正口径审计（统计≠听歌历史伪造）。
### ⑧ 前端高级化
承认现状工程样品级。已核实高星参考（api.github.com 2026-11-20）：
播放器 YesPlayMusic 33648★（高颜值布局/歌词页）、pear-desktop 34099★、AlgerMusicPlayer 17749★（桌面歌词）、
SPlayer 7356★（逐字歌词，archived 仅参考）、feishin 10452★（现代自托管播放器，GPL 仅参考不引代码）；
桌宠 BongoCat 24702★、openpets 1399★（本地优先伴生平台/plugin SDK）。
设计技能候选：ui-ux-pro-max-skill 152037★（配色/字体/布局设计智能）、apple-design-skill 3625★（Apple HIG 评审、
mac 高级感/liquid-glass）、genjutsu 823★（动效微交互、anti-AI-slop、先提交互论点再写码）。
方案（§4-Q2 决策安装范围）：绘灵领视觉升级提案+前后对比截图给用户审；
**继承石墨黑/暖灰/海玻璃绿三色与全部禁项**（无紫炫光/密集卡片/经验条/AI 星光）。

## 3. 建议阶段切分（决策后写入 goal）
S1 合并与数据统一（②+git 基线+P0 回归全绿）→ S2 mac 桌面灵宠（①+AR-04 采样）→
S3 播放器三件套+视觉升级（④⑧，含设计技能落地）→ S4 统计/推荐/同步增强（⑦⑤⑥按 Q1 口径）→
S5 端到端验收（守正签署 P1 检查单+verification-p1.md）。
每阶段 done-when 带可复跑命令与截图证据；问题集中一次性报 Chief 附推荐选项。

## 4. 一轮决策（每条附推荐）
Q1 喜欢同步口径：A 现有合规口径扩展到「我喜欢」歌单（推荐）／B 本地缓存灰区／C 非官方直读（改红线）。
Q2 设计技能安装：A ui-ux-pro-max + apple-design-skill + genjutsu 三件给绘灵（推荐）／B 仅 ui-ux-pro-max／C 不装自学参考。
Q3 首刀顺序：A S1→S5 如上（推荐，合并是其余一切的地基）／B 先桌宠+视觉看效果、合并后置／C 用户自定。
回复「都按推荐」或「1:A 2:B 3:A」式逐条即可。