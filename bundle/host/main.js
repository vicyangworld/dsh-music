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
import { createPreview, registerPreviewRoutes } from './preview.js'
import { createReco, registerRecoRoutes } from './reco/index.js'
import { registerCuration } from './curation.js'
import { createStarter } from './starter.js'
import { createOnboarding, registerOnboardingRoutes } from './onboarding.js'
import { createLifeService, registerLifeRoutes } from './life.js'

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
  const reco = createReco({ history, library, storage, config, logger })
  const starter = createStarter({ storage, library, config, logger })
  const onboarding = createOnboarding({ storage, library, starter, config, logger })
  const life = createLifeService({ storage, library, logger })

  let llm
  // A nested injection makes the model service optional across Harness profiles.
  if (config.curationProvider && config.curationModel && typeof ctx.inject === 'function') {
    ctx.inject(['llm'], (modelCtx) => {
      llm = modelCtx.llm
      modelCtx.effect(() => () => { llm = undefined })
    })
  }
  ctx.effect(() => {
    const disposers = [
      ...registerRoutes(ctx.webServer, { library, playback, storage, logger }),
      registerCuration(ctx.webServer, config, () => llm),
      ...registerMetadataRoutes(ctx.webServer, { library, storage, logger, config }),
      ...registerHistoryRoutes(ctx.webServer, { history, likes, logger }),
      ...registerDownloadRoutes(ctx.webServer, { download, logger }),
      ...registerSyncRoutes(ctx.webServer, { sync, logger }),
      ...registerManageRoutes(ctx.webServer, { manage, logger }),
      ...registerSearchRoutes(ctx.webServer, { search, logger }),
      ...registerLikesRoutes(ctx.webServer, { likes, logger }),
      ...registerPreviewRoutes(ctx.webServer, { preview, logger }),
      ...registerRecoRoutes(ctx.webServer, { reco, logger }),
      ...registerOnboardingRoutes(ctx.webServer, { onboarding, logger }),
      ...registerLifeRoutes(ctx.webServer, { life, logger }),
    ]
    return () => {
      for (const dispose of disposers) dispose()
      reco.dispose()
      starter.dispose()
      preview.dispose()
      download.dispose()
      sync.dispose()
      library.dispose()
    }
  })

  // 初次扫描异步进行，不阻塞激活；首个 library 请求会等待扫描完成。
  library.scan().catch((err) => logger.warn(`dsh-music: 初次扫描失败: ${err?.message ?? err}`))
}
