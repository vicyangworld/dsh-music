/** dsh-music Host 组装：存储 + 曲库 + 播放状态 + 路由。
 * 导出形式：apply(ctx, config) + inject（host-plugin.md 单一形式，不混用）。
 * 零外部依赖：仅 node: 内置模块；config 字段防御式读取，缺省即用。 */
import { createStorage } from './storage.js'
import { createLibrary } from './library.js'
import { createPlayback } from './playback.js'
import { registerRoutes } from './routes.js'
import { registerMetadataRoutes } from './metadata/index.js'
import { createHistory, registerHistoryRoutes } from './history.js'
import { createDownload, registerDownloadRoutes } from './download.js'
import { createSync, registerSyncRoutes } from './sync.js'
import { createManage, registerManageRoutes } from './manage.js'
import { createSearch, registerSearchRoutes } from './search.js'
import { createLikes, registerLikesRoutes } from './likes.js'
import { createSourceScan } from './source-scan.js'
import { createPreview, registerPreviewRoutes } from './preview.js'
import { createReco, registerRecoRoutes } from './reco/index.js'
import { createStarter } from './starter.js'
import { createOnboarding, registerOnboardingRoutes } from './onboarding.js'
import { createAccounts } from './accounts.js'
import { createLikedSync, registerLikedSyncRoutes } from './liked-sync.js'
import { createNetease } from './providers/netease.js'
import { createQQMusic } from './providers/qqmusic.js'
import { createQQLogin } from './providers/qqlogin.js'

export const inject = ['webServer']

export function apply(ctx, config = {}) {
  const logger = { warn: (msg) => ctx.logger?.warn?.(new Error(msg)) }
  const storage = createStorage(config)
  const library = createLibrary({ storage, config, logger })
  // S1-003：trackId/queue 存在性校验；首扫未完成时暂放行（历史落盘仍严格校验）。
  const playback = createPlayback({
    validateTrack: (id) => library.snapshot().scannedAt === 0 || library.getRecord(id) !== undefined,
  })
  const history = createHistory({ storage, library, logger })
  const download = createDownload({ storage, library, config, logger })
  const sync = createSync({ library, config, logger })
  const manage = createManage({ library, logger })
  const search = createSearch({ library, storage, logger })
  const preview = createPreview({ storage, config, logger })
  const likes = createLikes({ storage, library, download, logger, history })
  // 十三期：导入曲目后台找音源（只搜不下载；命中写回 likes.json 的 source，前端据此换成实心入库图标）
  const sourceScan = createSourceScan({ likes, search, logger })
  const reco = createReco({ history, library, storage, config, logger })
  const starter = createStarter({ storage, library, config, logger })
  const onboarding = createOnboarding({ storage, library, starter, config, logger })
  // QQ 音乐 / 网易云喜欢列表只读导入：默认开启但完全被动（不登录、不同步就不发任何请求）；config.likedSync=false 关闭。
  const accounts = createAccounts({ storage, logger })
  const likedSync = config.likedSync === false ? null : createLikedSync({
    likes, accounts, storage, logger,
    netease: createNetease({}),
    qqmusic: createQQMusic({}),
    qqlogin: createQQLogin({}),
    // 导入完成后立刻把新 ♥ 排进后台扫描（found 的会跳过，只扫还没结果的）
    onImported: () => { sourceScan.scheduleMissing().catch((err) => logger.warn?.(`dsh-music: 音源扫描排队失败: ${err.message}`)) },
  })

  ctx.effect(() => {
    const disposers = [
      ...registerRoutes(ctx.webServer, { library, playback, storage, logger }),
      ...registerMetadataRoutes(ctx.webServer, { library, storage, logger, config }),
      ...registerHistoryRoutes(ctx.webServer, { history, likes, logger }),
      ...registerDownloadRoutes(ctx.webServer, { download, logger }),
      ...registerSyncRoutes(ctx.webServer, { sync, logger }),
      ...registerManageRoutes(ctx.webServer, { manage, logger }),
      ...registerSearchRoutes(ctx.webServer, { search, logger }),
      ...registerLikesRoutes(ctx.webServer, { likes, logger, scan: sourceScan }),
      ...registerPreviewRoutes(ctx.webServer, { preview, logger }),
      ...registerRecoRoutes(ctx.webServer, { reco, logger }),
      ...registerOnboardingRoutes(ctx.webServer, { onboarding, logger }),
      ...registerLikedSyncRoutes(ctx.webServer, { likedSync, logger }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      if (likedSync) likedSync.dispose()
      sourceScan.dispose()
      reco.dispose()
      starter.dispose()
      preview.dispose()
      download.dispose()
      sync.dispose()
      library.dispose()
    }
  })

  // 初次扫描异步进行，不阻塞激活；首个 library 请求会等待扫描完成。
  library.scan()
    .catch((err) => logger.warn(`dsh-music: 初次扫描失败: ${err?.message ?? err}`))
    // 启动后给还没入库的导入曲目排一次后台音源扫描（found / 近 7 天 none 的会跳过，几乎零成本）
    .then(() => sourceScan.scheduleMissing())
    .catch((err) => logger.warn(`dsh-music: 音源后台扫描排队失败: ${err?.message ?? err}`))
}