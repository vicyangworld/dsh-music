# 发布流程（维护者）

本文件说明 dsh-music 如何从仓库发到 GitHub、npm 与 DSH 插件目录（market / awesome-dsh-plugin）。**发布动作只在用户提供凭据后执行**，仓库内不保存任何 token。

版本：`0.8.0`（十四期，2026-11-26）。发布前请先读「发布前检查」。

## 包名约定（批5 改名）

- **品牌名**保持 `dsh-music`（面板、文档、GitHub 仓库名不变）。
- **npm 包名**是 **`@vicyangorg/dsh-music`**：原名 `dsh-music` 已被 2026-08-19 注册的占位包占用（维护者 dushaobindoudou，`dsh-music@0.0.1`，描述 "name reserved"，无实质代码），无法以原名发布。**批5 实际发布时又发现 `@dshbottest` scope 在 npm 不存在（PUT 报 E404 Scope not found），遂改用发布凭据账号 `vicyangorg` 自己的 scope，最终 npm 包名定为 `@vicyangorg/dsh-music`；品牌名 / GitHub 仓库 / 数据目录 / HTTP 路径均不变。**
- npm 账号 `vicyangorg`；scoped 包默认 restricted，`package.json` 已设 `publishConfig: {"access":"public"}`，发布时也可显式 `--access public`。
- DSH 硬性规则：**client 工厂 id 必须等于完整包名**（先例 `@zilliz/memsearch-dsh`），因此 client 工厂 id 也是 `@vicyangorg/dsh-music`。
- `cordis.patch.yml` 的插件行 `name` 同步为新包名，`id` 仍为 `dsh-music`。
- 数据目录 `~/.dsh/dsh-music/` 与 HTTP 路径 `/dsh-music/api/*` 是硬编码内部标识，**不随改名变化**，老用户数据零迁移。

## 0. 首次建仓（批5 发布前必做，P1）

当前项目目录尚不是 git 仓库。首次发布前按序完成（建远程仓库属外部动作，须用户凭据经 `request_secret` 注入后进行）：

```bash
# 仓库根
git init -b main
cat > .gitignore <<'EOF'
node_modules/
dist/
*.tgz
.DS_Store
EOF
git add -A
git status   # 人工确认：无 token、无用户数据（~/.dsh/、~/Music/ 本就在仓库外）、无测试产物
git commit -m "dsh-music 0.3.0"
# 在用户 GitHub vicyangworld 名下建公开空仓库 dsh-music（gh repo create 或网页）
git remote add origin https://github.com/vicyangworld/dsh-music.git
git push -u origin main
```

随后在仓库 Settings 开启 Discussions（分类按 community-design.md §4：Show & Tell / 每周主题 / Ideas / Q&A），并附 CODE_OF_CONDUCT.md。

## 1. 仓库结构

```text
dsh-music/                     # 仓库根（GitHub: vicyangworld/dsh-music）
├── bundle/                    # 发布包根（npm pack 的包根，唯一包源）
│   ├── package.json           # 清单：version / repository / files / dsh.bundle / dsh.client
│   ├── index.js               # Host 入口：export { apply, inject }
│   ├── host/                  # Host 服务与 HTTP 路由
│   ├── client/index.js        # Client 产物（单文件，无构建步骤）
│   ├── locale/*.json          # 8 语插件详情 meta
│   ├── icon.svg               # 原创图标
│   ├── README.md              # npm / 市场卡片文案
│   └── docs/                  # DETAIL.md + assets/（随包发布，meta.detail 指向此处）
├── docs/                      # 仓库文档（不随 npm 包发布）
│   ├── publishing.md          # 本文件
│   └── community-design.md    # 社区功能设计稿（0.3，本期仅设计）
├── tests/                     # 打包 / 冷装 / 冷启动自检（baseline/ 除外）
├── scripts/                   # 各批次隔离测试与冒烟
├── README.md / LICENSE / .gitignore
```

要点：**npm 包根是 `bundle/`**，`package.json` 的 `files` 相对 `bundle/` 解析；仓库根 `docs/` 不进包。插件详情页正文是 `bundle/docs/DETAIL.md`（随包），由 `locale/*.json` 的 `meta.detail` 指向。

**隐私排除（.gitignore，红线：历史/缓存仅存本地）**：验收证据 `docs/verification-*`、审计 `docs/distribution-*`、`docs/reco-diversity.md`、测试基线 `tests/baseline/`（用户真实曲库清单与 token 元数据快照）、内部团队文档 `GOAL/TEAM/HANDOFF/PRD/CONSTRAINTS.md`、`.memsearch/` 一律不进公开仓库——它们含用户收听数据、GUI 截图与本机路径。验收证据仍留本地供 group_goal 核查。

## 2. 发布前检查（必须全绿）

在仓库根执行：

```bash
# 1) 包清单 / 详情页 / 图片 / README / 元数据
node tests/packaging-check.mjs        # 期望 ALL PASS

# 2) Host 真实 import 图（34 模块）+ apply/inject
node scripts/import-smoke.mjs         # 期望 OK

# 3) 冷装：对真实 tgz 解包目录做完整校验
npm pack ./bundle --pack-destination /tmp/dshm-pack
mkdir -p /tmp/dshm-cold && tar -xzf /tmp/dshm-pack/vicyangorg-dsh-music-0.3.0.tgz -C /tmp/dshm-cold
node tests/cold-install-smoke.mjs /tmp/dshm-cold/package   # 期望 ALL PASS

# 4) 包内容确认（DETAIL + 4 图 + README + client）
npm pack --dry-run --json ./bundle | head -40
```

同时确认：`name=@vicyangorg/dsh-music` 且 `publishConfig.access=public`；版本号只在 `bundle/package.json`（`cordis.patch.yml` 不写版本）；`repository/homepage/bugs` 指向 `github.com/vicyangworld/dsh-music`；`private:false`、`license: MIT`、`engines.dsh` 仍与当前 DSH 兼容。

**截图隐私检查（push/publish 前必做）**：`bundle/docs/assets/*` 随包公开，必须是**音乐面板裁剪版**——不得含 DSH 侧栏（用户名/其他会话标题）、用户真实收听历史或真实曲库行。历史统计类截图禁止发布（内容即用户历史，无法脱敏）；曲库截图只允许工具栏区域。首次建仓的初始提交也必须在截图整改完成后进行，避免用户数据进入 git 历史。

## 3. npm 发布

前提：使用 npm 账号 `vicyangorg`（本机 `npm login` 或设置 `NPM_TOKEN`）。包名 `@vicyangorg/dsh-music` 归属该账号；发布前可 `npm view @vicyangorg/dsh-music` 确认版本未占用。

```bash
cd bundle
npm pack --dry-run              # 再确认清单与体积
npm publish --access public     # scoped 包必须显式公开（publishConfig 已设，双保险）
# 如提示 2FA 按提示输入
```

发布后验证：

```bash
npm view @vicyangorg/dsh-music version dist.tarball
# 他人安装（DSH 内）：
# plugin_manager(install_bundle, target: "@vicyangorg/dsh-music@0.3.0")
```

注意：`files` 已排除测试与仓库 docs；无 `prepare`/`postinstall` 等 build scripts，安装不会触发脚本审批。

## 4. GitHub Release

```bash
# 仓库根，确保工作区干净且已推送
git tag -a v0.3.0 -m "dsh-music 0.3.0"
git push origin main --tags

# 产出发布附件（tgz 来自 npm pack，与 npm 同一份）
npm pack ./bundle --pack-destination dist
gh release create v0.3.0 dist/vicyangorg-dsh-music-0.3.0.tgz \
  --title "dsh-music 0.3.0" \
  --notes-file <(sed -n '1,40p' bundle/README.md)
```

Release 说明至少写：七期变更（悬浮标/应用内顶层与跨应用限制、统一试听、常听列表播放、欢迎页 + starter 公有领域曲库、taste 软偏置、社区设计稿）、安装命令、数据位置、已知限制。附件 tgz 可用于 `install_bundle target=<tgz URL>`。

## 5. 收录到 DSH 插件目录（awesome-dsh-plugin / market）

市场「Discover 一键装」只认策展注册表 `awesome-dsh-plugin` 内的条目：

1. Fork `awesome-dsh-plugin` 仓库，按 README 的条目格式新增一行/一条：
   - 名称 `dsh-music`（展示名）、仓库 `https://github.com/vicyangworld/dsh-music`、npm 包 `@vicyangorg/dsh-music`、版本 `0.3.0`；
   - 一句话中文 + 英文描述、分类（音乐/媒体）、平台 `web`、图标/截图（`bundle/icon.svg`、`bundle/docs/assets/*`）。
2. 确认其索引（format-1，例如 `cdn.jsdelivr.net/npm/dsh-plugin-catalog/index.json`）能解析到本包，且 `engines.dsh` 兼容声明与当前 DSH 一致。
3. 提 PR，标题 `Add dsh-music plugin`，说明里附 npm 包链接、Release 链接、安装命令与截图；按维护者模板补齐字段。
4. 合并后用**干净 profile** 验收：市场搜索到 dsh-music → 一键安装 → `application: applied` → 刷新后左侧栏出现音乐面板。

## 6. 安全与红线

- 任何 token（GitHub / npm）只经用户 `request_secret` 注入环境变量，不进仓库、不进包、不写进 `~/.dsh/dsh-music/` 或日志。
- 绝不读取/移动/删除 `~/.config/spotify-sync/refresh_token`；Spotify 同步只经 spotify-sync CLI 间接使用凭据。
- 发布包不得包含用户数据：`~/.dsh/dsh-music/`、`~/Music/` 下任何文件、测试产物（如 `~/Music/dsh-music/starter/` 下的联调文件）。
- 试听/下载音源上限 YT Music ~128k AAC，不引入盗版音源；starter 曲目必须逐首核实为 CC0/公有领域并保留署名。
- 发布是外部动作：仅在用户明确指示、凭据就绪后执行；失败时如实报错，不猜测或绕过凭据。

## 7. 发布结果（2026-11-14 活体复核）

七期 v0.3.0 发布五项活体全绿：

| 项 | 状态 | 链接/标识 |
| --- | --- | --- |
| GitHub 公开仓库 | ✅ live（HTTP 200） | https://github.com/vicyangworld/dsh-music |
| GitHub Release（tgz） | ✅ published 2026-11-14T04:55:21Z | https://github.com/vicyangworld/dsh-music/releases/tag/v0.3.0（release id 445025536，asset id 746344124） |
| npm 包 | ✅ live | `@vicyangorg/dsh-music@0.3.0`，tarball https://registry.npmjs.org/@vicyangorg/dsh-music/-/dsh-music-0.3.0.tgz |
| plugin_manager 安装 | ✅ applied（fiberPhase=active） | include:dsh-music，moduleName `@vicyangorg/dsh-music`，enabled=true |
| README 七期 | ✅ 已补 | README.md 七期表 |

**唯一缺口：awesome-dsh-plugin 目录 PR 未提（外部受阻，按目标「如实记录受阻＋配合项」收尾）。**

- 受阻原因：需 `GITHUB_TOKEN` 才能 fork + 提 PR；当前无已保存凭据（`list_secrets` 为空），`request_secret` 仅能在 Chief 单独对话弹安全卡片。
- 配合项（一次性）：用户到 Chief 单独对话发「发布凭据」→ 弹 `GITHUB_TOKEN`（classic PAT，repo 权限）安全卡片 → 注入 env var 后由 Chief fork `awesome-dsh-plugin/awesome-dsh-plugin`、按 §5 加 data 条目、提 PR `Add dsh-music plugin`，合并后干净 profile 验收市场一键装。
- 现状不影响安装：GitHub + npm 已可经 `plugin_manager install_bundle target="@vicyangorg/dsh-music@0.3.0"` 安装；目录 PR 仅关乎市场 Discover 曝光，留作凭据就绪后的后续项。

## 8. 八期 v0.4.0 发布（2026-11-14）

八期四点（真新歌推荐 / 全流派 / 我喜欢与不喜欢 / 品牌 logo）开发＋活体验证完成，推 v0.4.0：

| 项 | 状态 | 链接/标识 |
| --- | --- | --- |
| git 提交 | ✅ push main | commit `5d8443a` feat(v0.4.0) |
| GitHub Release（tgz） | ✅ published | https://github.com/vicyangworld/dsh-music/releases/tag/v0.4.0 ，asset `vicyangorg-dsh-music-0.4.0.tgz`（311528 B，gzip 校验通过，HTTP 206） |
| 目录 PR #15213 | ✅ tarball 改钉 v0.4.0 | commit `f2d2d12` push add-dsh-music；唯一红=仓库满 1 天门槛（2026-11-15T01:20:25Z 自动转绿） |
| npm 包 0.4.0 | ✅ live（latest） | `@vicyangorg/dsh-music@0.4.0`，tarball https://registry.npmjs.org/@vicyangorg/dsh-music/-/dsh-music-0.4.0.tgz ，shasum `5033bab3…` 与发布输出一致；registry packument 直查 `dist-tags.latest=0.4.0`；包内含 icon.png/八期代码 |
| 测试 | ✅ 全绿 | reco 143 / taste 39 / render 68 / packaging 14；红线 7 绿 |

**npm publish 凭据经过（已解决）：** 首次 `npm publish` 返回 `E403 ... Two-factor authentication or granular access token with bypass 2fa enabled is required to publish packages.`（经典令牌无「绕过 2FA」权限）。用户更新本机 `~/.npmrc` 为带 Bypass 2FA 的 granular token 后，`npm publish` 成功发布 0.4.0（`+ @vicyangorg/dsh-music@0.4.0`）。

- 教训沉淀：npm 发布包须 granular token 且勾选 Bypass two-factor authentication，经典令牌一律 E403；`npm view` 有本地缓存滞后，验新版本用 registry packument 直查（curl + Accept: application/json）。
- 现状：四渠道全绿——GitHub Release v0.4.0 tgz / npm latest 0.4.0 / 目录 PR #15213 钉 v0.4.0（仓库满 1 天门槛 2026-11-15T01:20:25Z 自动转绿）/ 本机链接目录开发装。

## 9. 九期 v0.5.0 发布（2026-11-14）

| 环节 | 结果 | 证据 |
|---|---|---|
| git | ✅ | commit e8f1142 push main（九期功能+0.5.0+README 九期表+v9 实拍 webp×3+测试版本断言改动态） |
| 测试 | ✅ 全绿 | reco 148 / persistent-cache 13 / selftest 24 / render 74 / packaging 14 / cold-install 20（修复 N1：cold-install:37 版本断言钉死 0.3.0 → 动态读 bundle/package.json；packaging-check:47 同改动态）；verification-v9 0 阻塞 |
| 重启后活体 | ✅ | host 持久缓存端到端：Coldplay 冷调 45s+（维基兜底回写 cache/artists/coldplay.json fetchedAt=21:37:19），二调 8.1s 文件 mtime/fetchedAt 不变=零维基重拉 ✅；无维基资料歌手（sottovoce/Vulfpeck）不写缓存（失败不写）且 MB 缓存吸收重复（23.7s→0.89s、33.4s→1.3s）✅ |
| npm | ✅ | `npm publish` → `+ @vicyangorg/dsh-music@0.5.0`；packument 直查 dist-tags.latest=0.5.0（CDN 复制约 1 分钟，官方 tarball sha1 b90ef8f8d16c00135c1e3c06c64e40701416e480 与发布 tgz 一致） |
| GitHub Release | ✅ | https://github.com/vicyangworld/dsh-music/releases/tag/v0.5.0 资产 vicyangorg-dsh-music-0.5.0.tgz 活体 200（415665B） |
| 目录 PR #15213 | ✅ 已钉 | commit 51d1104 tarball → v0.5.0；PR OPEN head=51d1104；仓库满 1 天门槛 2026-11-15T01:20:25Z（本地 09:20）CI 自动转绿，余候维护者审核 |

- dshmarket 检索机制（已核 dshmarket 1.73.17 源码）：发现页只读官方目录（全球 awesome-dsh-plugin.com/plugins.json / 中国区 npm 包 dsh-plugin-catalog，每日 build），不做全网 npm 搜索；PR 合并+目录重建后 dshmarket 自动可见，无需用户任何操作。

## 10. 十期 v0.6.0 发布（2026-11-15）

| 环节 | 结果 | 证据 |
|---|---|---|
| git | ✅ | commit b51a143 push main（十期功能：当日快照 cache/reco/sections-daily.json + POST /reco/sections/refresh + client 三栏刷新按钮/转圈反馈 + README 十期表 + 0.6.0） |
| 测试 | ✅ 全绿 | reco 167 / render 84 / packaging 14 / cold-install 20 / persistent-cache 13；verification-v10 0 阻塞（GUI：三栏刷新按钮实拍、行播放转圈约 6s 恢复；整栏转圈/当日固化单测覆盖） |
| 重启后活体 | ✅ | ①refresh 路由：GET→405、POST 非法 axis→400、POST {"axis":"new"}→200 且 refreshed="new"；②当日固化：GET /reco/sections fromCache={today:true,artist:true,new:true}（sections-daily.json date=2026-11-15）；③refresh 只动指定栏：POST 后 fromCache={today:true,artist:true,new:false}，快照文件仅 new.generatedAt 更新 |
| npm | ✅ | `npm publish` → `+ @vicyangorg/dsh-music@0.6.0`；packument dist-tags.latest=0.6.0，tarball https://registry.npmjs.org/@vicyangorg/dsh-music/-/dsh-music-0.6.0.tgz，shasum 1f296baa46e1eac1470b052e954d0c7cce92998b 与发布 tgz 一致（CDN 复制约 4 分钟） |
| GitHub Release | ✅ | https://github.com/vicyangworld/dsh-music/releases/tag/v0.6.0 资产 vicyangorg-dsh-music-0.6.0.tgz 活体 200（419733B，created 2026-11-15T02:41:32Z） |
| 目录 PR #15213 | ✅ 已钉 | commit 70e407d tarball → v0.6.0；checks 全绿（Submission gate pass + check pass 17m58s）；MERGEABLE，余候维护者审核 |

## 11. 十一期～十三期 v0.7.0 发布（2026-11-26）

| 环节 | 结果 | 证据 |
|---|---|---|
| git | ✅ | `feat/cn-liked-sync` 快进合并到 main（20 个提交：设置页 / 网易云 + QQ 音乐扫码导入 / 后台找音源 / 下载队列 + 状态面板 / 迷你条 ♥ 👎 / 点播修复）→ `e248a47 feat(v0.7.0)`；tag `v0.7.0` 已推送 |
| 测试 | ✅ 全绿 | packaging 14/14、import-smoke 34 模块、cold-install 20/20（对真实 tgz 解包目录）、render-smoke 179/179、liked-sync 30、liked-sync-client 21、source-scan 7、download-queue、icon-route 4、v6b4、v3b1、v8-taste；活体 `verify-routes.sh` 38/38（热重载后的真实主机）。实机走查：设置页 / 扫码导入 / 队列 / 面板由用户在真实 DSH 中逐项验证（截图为 mock 预览，不是真机截图）；QQ 扫码链路的插件内闭环仍待用户解除「登录频繁」后复验 |
| npm | ✅ | `npm publish --access public` → PUT 202（异步处理，约 3 分钟后可见）→ `+ @vicyangorg/dsh-music@0.7.0`；packument dist-tags.latest=0.7.0，tarball https://registry.npmjs.org/@vicyangorg/dsh-music/-/dsh-music-0.7.0.tgz（507974B，活体 200），shasum `0e271cc747c78ed67ea98478241f6dac8cd20bd4`（与本地 tgz 一致） |
| GitHub Release | ✅ | https://github.com/vicyangworld/dsh-music/releases/tag/v0.7.0 资产 vicyangorg-dsh-music-0.7.0.tgz（507974B，published 2026-11-26T02:54:15Z，活体 200）；说明含新功能 / 修复 / 安装命令 / 数据位置 / 已知限制 |
| 目录 PR | ✅ 已提 | PR #15213（v0.6.0）已合并；本次从 fork 新开 https://github.com/awesome-dsh-plugin/awesome-dsh-plugin/pull/18923 「Update dsh-music to 0.7.0」（tarball → v0.7.0，中英描述补导入 / 后台找音源 / 队列），OPEN / MERGEABLE，候维护者审核 |

注意：npm 发布现在返回 202 异步处理，`npm view` 可能要等几分钟才看到新版本，不要重复 publish。
