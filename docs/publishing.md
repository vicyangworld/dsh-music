# 发布流程（维护者）

本文件说明 dsh-music 如何从仓库发到 GitHub、npm 与 DSH 插件目录（market / awesome-dsh-plugin）。**发布动作只在用户提供凭据后执行**，仓库内不保存任何 token。

版本：`0.3.0`（七期批3 发布预备）。发布前请先读「发布前检查」。

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
