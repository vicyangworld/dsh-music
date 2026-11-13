# 阶段 2 接口契约：歌词 + 歌手内容（拾词 ↔ 织音/磐石）

状态：草案 v1，待织音（UI 字段）与磐石（Host 接线）确认后冻结。确认后不擅自改动，有异议先群里协商。
写范围：本目录 `bundle/host/metadata/` 与 `scripts/content/`。缓存只写 `~/.dsh/dsh-music/cache/`。

## 0. 集成方式（需磐石确认，2 处小改，均在磐石写范围）

拾词交付 `bundle/host/metadata/index.js`，导出：

```js
export function registerMetadataRoutes(webServer, { library, storage, logger, config }) // → disposers[]
```

磐石在 `bundle/host/main.js` 接线（示意，3 行）：

```js
import { registerMetadataRoutes } from './metadata/index.js'
// ctx.effect 内：
const metaDisposers = registerMetadataRoutes(ctx.webServer, { library, storage, logger, config })
return () => { for (const d of [...disposers, ...metaDisposers]) d(); library.dispose() }
```

**打包关键**：`bundle/package.json` 的 `files` 现为 `"host/*.js"`（单层 glob，不含子目录）。
必须新增 `"host/metadata/*.js"`（或改 `"host/**/*.js"`），否则新模块不会被打进 bundle。请磐石一并改。

依赖注入说明：metadata 只用 `library.getRecord(id)`、`storage.dataDir`（推导缓存目录）、`logger.warn(字符串)`、`config`（ffprobePath/ffmpegPath/dataDir）。
`getRecord(id)` 真实形状（磐石核实）：`{ id, filePath, format, mime, source, meta:{ mtimeMs, size, title, artist, album, duration, hasCover, coverCodec } }`。
title/artist/album/duration 在 **`record.meta`** 下（album/duration 可为 null）；`filePath` 为绝对路径，**仅供 Host 内部用，绝不进 API 响应**。
不修改 library/storage/tags/routes 任何既有文件；内嵌歌词探测由 metadata 自带 ffprobe 调用完成。

## 1. 歌词端点（F3）

`GET /dsh-music/api/lyrics?track=<id>`  （kind: exact；仅 GET；id 为曲库 16 位 hex）

成功 200 JSON：

```jsonc
{
  "trackId": "a1b2c3d4e5f60718",
  "source": "lrclib",            // "embedded" | "lrclib" | "web" | "none"
  "synced": true,                 // true=逐句同步（可滚动高亮）；false=纯文本
  "lines": [                      // synced=true 按 time 升序；synced=false 时 time=null
    { "time": 28.64, "text": "鐘聲響起歸家的訊號" }
  ],
  "plain": "鐘聲響起歸家的訊號\n…",  // 纯文本整段；无则 null
  "cached": false,                // 是否命中本地缓存（二次打开 true，秒开）
  "fetchedAt": 1731400000000,     // 内容获取/调研时间戳（ms）
  "message": null                 // source="none" 时为中文提示，如 "暂无歌词，仅播放"
}
```

降级（LRCLIB 无命中且无内嵌/联网歌词）：**HTTP 200**，`source:"none", synced:false, lines:[], plain:null, message:"暂无歌词，仅播放"`。绝不抛错、绝不 5xx。
非法 id → 404 `{error:"无效的曲目 id"}`；id 不在曲库 → 404 `{error:"曲目不存在或尚未扫描，请先重新扫描"}`。

管线顺序（命中即写缓存并返回）：
1. `cache/lyrics/<id>.json` 命中 → 直接返回（cached:true，秒开）。
2. 内嵌标签歌词（ffprobe 读 `LYRICS`/`UNSYNCEDLYRICS`/`SYLT`）→ source:"embedded"。
3. LRCLIB live：先 `GET /api/get?artist_name&track_name&album_name&duration`（duration 未知则**省略该参数**，传空串会 400），未命中再 `GET /api/search?q=<artist+title>`，按时长接近度择优 → source:"lrclib"。
4. 联网调研缓存 `cache/lyrics/web/<artist-title-slug>.json`（由 scripts/content 预填）→ source:"web"。
5. 都没有 → source:"none"（none 结果也缓存，TTL 24h，避免反复打 LRCLIB）。

LRC 解析：`syncedLyrics` 行 `[mm:ss.xx] 文本` → `{time: mm*60+ss.xx, text}`；多时间标签复用同行文本；空文本行保留（间奏）。`plainLyrics` 原样作 plain。

## 2. 歌手端点（F4）

`GET /dsh-music/api/artist?name=<artist>`  （kind: exact；仅 GET；name 为歌手名原文）

成功 200 JSON：

```jsonc
{
  "name": "Beyond",
  "intro":  { "text": "…", "source": "维基百科", "url": "https://zh.wikipedia.org/wiki/Beyond", "date": "2026-11-12" },
  "news":   [ { "text": "…", "source": "…", "url": "…", "date": "YYYY-MM-DD" } ],
  "trivia": [ { "text": "…", "source": "…", "url": "…", "date": "YYYY-MM-DD", "kind": "fact" } ],  // kind: "fact"|"rumor"
  "similarArtists": [ { "name": "太極樂隊", "reason": "…", "source": "…", "url": "…" } ],
  "similarSongs":   [ { "title": "海闊天空", "artist": "Beyond", "reason": "…", "source": "…", "url": "…" } ],
  "cached": true,
  "fetchedAt": 1731400000000,
  "message": null                 // 无缓存且 live 兜底也空时："暂无该歌手内容"
}
```

每条 intro/news/trivia **必带 source 与 date**（红线）；trivia 用 kind 区分事实/传闻。
管线：`cache/artists/<name-slug>.json` 命中 → 返回（cached:true）。未命中 → best-effort  live 维基百科 zh REST summary 取 intro（免费无 key），news/trivia/similar 留空并 message 提示「详细内容由调研补齐」。
歌手深度内容（动态/逸闻/相似）由拾词用 `scripts/content/` 联网调研后预填缓存；Host 运行时只读缓存 + 维基 live 兜底，不调 LLM、不依赖付费 key。

## 3. 缓存布局（仅 `~/.dsh/dsh-music/cache/`）

```
cache/lyrics/<trackId>.json        每首已解析歌词（任意来源），二次打开秒开
cache/lyrics/web/<slug>.json       联网调研歌词兜底（scripts/content 预填）
cache/artists/<slug>.json          歌手内容（scripts/content 预填）
```

slug：小写、保留中日韩字符、其余非字母数字转 `-`、去首尾 `-`。原子写（tmp+rename），与 storage.writeJson 同风格。
缓存均为本机数据，不上传、不遥测。 fresh install 无缓存时自动走 LRCLIB/维基 live，优雅降级。

## 4. 调研脚本（scripts/content/，拾词写范围）

- `research-artist.mjs <name>`：联网调研歌手简介/动态/逸闻/相似，每条带来源 URL+日期，写 `cache/artists/<slug>.json`。
- `research-lyrics.mjs <artist> <title>`：LRCLIB 无命中时联网补齐歌词，写 `cache/lyrics/web/<slug>.json`。
脚本用 node22 全局 fetch + 公开页（维基/MusicBrainz/Last.fm 公开页/新闻），不依赖付费 key；产物即缓存，Host 直接读。

## 5. 验收映射（GOAL.md 阶段 2）

1. 光辉岁月逐句同步歌词 → `/api/lyrics?track=<光輝歲月id>` 返回 source:"lrclib", synced:true, lines 带 time（已实测 LRCLIB 命中）。
2. Beyond 卡片简介/动态/逸闻（来源+日期）+ 相似 → `/api/artist?name=Beyond` 读预填缓存。
3. LRCLIB 无命中歌曲降级 → source:"none" + 中文 message，HTTP 200 不报错。
4. 缓存落 `~/.dsh/dsh-music/cache/`，二次打开 cached:true 秒开。