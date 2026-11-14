/**
 * dsh-music — Client half (S1: 曲库 + 播放 + UI 骨架).
 *
 * Single self-contained browser artifact, registered through the Harness
 * module loader. No build step, no Harness Client package imports: React
 * comes from the browser module table; every color is a --dsw-alias-* theme
 * token so light/dark follow the host. Visible text goes through the Client
 * locale service (namespace `dshMusic`, zh + en).
 *
 * Surfaces (verified against ui-layout / ui-sidebar contracts):
 *   - sidebar.panellist : global "音乐" panel icon (owner props {size, active})
 *   - main (keyed)      : the music panel, key = 'music'
 *   - shell.overlay     : persistent mini player, mounted across navigation
 *
 * The audio engine is a singleton owned by apply() (NOT by any React
 * component), so playback survives main-panel switches; the mini player in
 * shell.overlay stays mounted and keeps controlling it.
 *
 * Host contract (agreed with 磐石, S1): same-origin HTTP routes under
 * /dsh-music — GET api/library, POST api/rescan, prefix audio/ (Range),
 * prefix cover/. See bundle/host and docs for the Host half.
 */
window.__ModuleLoader__.load({
  id: '@vicyangorg/dsh-music',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef, useCallback } = React;

    /* The mini player should sit above every panel/dialog of the DSH shell.
     * Portalling to <body> is the only reliable way to escape a host stacking
     * context; when react-dom is not in the module table we fall back to a
     * fixed, very high z-index node rendered in place. */
    let ReactDOM = null;
    try { ReactDOM = require('react-dom'); } catch { ReactDOM = null; }
    function portalToBody(node) {
      if (!ReactDOM || typeof ReactDOM.createPortal !== 'function' || typeof document === 'undefined') return node;
      return ReactDOM.createPortal(node, document.body);
    }

    const NS = 'dshMusic';
    const PANEL_ID = 'music';

    /* ================================================================
     * 1. Locale dictionaries (zh primary, en fallback)
     * ================================================================ */
    const zh = {
      panel: '音乐',
      welcomeTitle: '欢迎使用 dsh-music',
      welcomeSub: '本地优先的音乐库与推荐。花一分钟告诉我你想听什么，我把界面调到合你口味。',
      welcomeStart: '开始设置',
      welcomeSkip: '先随便看看',
      welcomeBack: '返回界面',
      welcomePoint1: '播放本地曲库，歌词与歌手资料齐全',
      welcomePoint2: '按你的口味推荐，喜欢的歌才入库',
      welcomePoint3: '所有数据只留在这台电脑上',
      welcomeTasteTitle: '你喜欢听什么？',
      welcomeTasteSub: '可以多选，也可以跳过；之后随时能在推荐里调整。',
      welcomeGenres: '流派',
      welcomeLanguages: '语言',
      welcomePrev: '上一步',
      welcomeNext: '下一步',
      welcomeLibTitle: '从哪里开始？',
      welcomeLibSub: '已经有本地音乐就选第一个；没有的话，我准备了一个免费的公共版权 starter 曲库。',
      welcomeLocalTitle: '使用我已有的音乐库',
      welcomeLocalBody: '扫描 ~/Music/dsh-music、spotify-liked 等默认目录',
      welcomeStarterTitle: '用插件默认 starter 曲库',
      welcomeStarterBody: '几首 CC0 / 公有领域曲目，逐首核实并署名',
      welcomeStarterHint: '曲目会串行取回到 ~/Music/dsh-music/starter，完成后自动入库；网络失败会跳过，不影响使用。',
      welcomeLocalHint: '完成后会立即扫描曲库并进入曲库页。',
      welcomeFinish: '完成',
      welcomeStarterDownloading: '正在准备 starter 曲库…',
      welcomeStarterReady: 'starter 曲库已就绪',
      welcomeStarterSkipped: '网络不可用，已跳过 starter，稍后可在推荐页探索',
      welcomeCredits: '曲目与许可',
      welcomeEnter: '进入推荐',
      welcomeSaveFail: '保存失败，请重试',
      welcomePreview: '预览欢迎页',
      genre_jazz: '爵士',
      genre_classical: '古典',
      genre_electronic: '电子',
      genre_blues: '布鲁斯',
      genre_reggae: '雷鬼',
      genre_soul: '灵魂乐',
      genre_folk: '民谣',
      genre_metal: '金属',
      genre_funk: '放克',
      genre_ambient: '氛围',
      lang_zh: '中文',
      lang_en: '英语',
      lang_yue: '粤语',
      lang_ja: '日语',
      lang_ko: '韩语',
      lang_fr: '法语',
      lang_es: '西班牙语',
      lang_pt: '葡萄牙语',
      lang_it: '意大利语',
      welcomeTasteNote: '偏好只用于微调探索批次，不会锁死你的推荐；之后随时能改。',
      welcomePathLabel: '音乐目录（可选）',
      welcomePathPlaceholder: '~/Music/我的音乐',
      welcomePathHint: '留空则使用已经扫描到的曲库；填了会自动挂载并重新扫描。',

      tabLibrary: '曲库',
      tabReco: '推荐',
      tabNow: '正在播放',
      searchPlaceholder: '搜索歌曲、歌手或专辑',
      groupNone: '列表',
      groupArtist: '按歌手',
      groupAlbum: '按专辑',
      groupLabel: '分组方式',
      rescan: '重新扫描',
      rescanning: '扫描中…',
      tracksUnit: '首',
      playAll: '播放全部',
      shufflePlay: '随机播放',
      loading: '正在扫描曲库…',
      loadError: '曲库加载失败',
      retry: '重试',
      emptyLibraryTitle: '曲库还是空的',
      emptyLibraryBody: '搜歌手或歌名就能在线试听，喜欢的歌会自动入库；已有音乐也可以放进扫描目录。',
      emptySearchCta: '搜歌手/歌名试听',
      emptyAddDirHint: '默认扫描目录（支持 mp3 / flac / m4a / wav 等）：',
      emptyRescanCta: '重新扫描曲库',
      emptyDirNote: '也可以在插件配置里用 directories 自定义扫描目录。',
      syncOptional: 'Spotify 同步（可选）',
      syncOptionalHint: '可选功能：需要机器上已安装 spotify-sync CLI，没有也不影响听歌',
      syncUnavailableHint: '未检测到 spotify-sync CLI，同步功能暂不可用（可跳过，不影响听歌）',
      exploreChip: '探索批次',
      recoColdTitle: '还没有收听历史',
      recoColdBody: '先搜歌手或歌名试听，喜欢的歌会自动入库；听过几首后这里会按你的口味推荐。',
      unknownAlbum: '未知专辑',
      unknownArtist: '未知歌手',
      nowPlaying: '正在播放',
      queue: '播放队列',
      queueEmpty: '队列空空如也，去曲库点一首歌吧。',
      noTrackTitle: '还没有在播放的歌',
      noTrackBody: '去曲库挑一首，按下播放，这里会变成你的专属播放台。',
      goLibrary: '去曲库',
      play: '播放',
      pause: '暂停',
      prev: '上一首',
      next: '下一首',
      shuffle: '随机播放',
      shuffleOn: '随机播放：开',
      repeat: '循环模式',
      repeatOff: '循环：关',
      repeatAll: '循环：列表循环',
      repeatOne: '循环：单曲循环',
      volume: '音量',
      mute: '静音',
      unmute: '取消静音',
      stop: '停止并关闭',
      miniLabel: '迷你播放条',
      openNow: '打开正在播放',
      playError: '播放出错',
      recoTitle: '推荐',
      recoBody: '基于你的收听历史，每批约 10 首：7 首口味相近 + 3 首强制探索（流派 / 语言 / 年代轮换，还有"意外之喜"位），帮你打破信息茧房。',
      recoNote: '每首候选都会先联网核实真实存在，附推荐理由；试听不占空间，喜欢的歌才自动入库到 ~/Music/dsh-music。',
      recoTaste: '口味相近',
      recoSimilar: '相近',
      recoExplore: '强制探索',
      recoVerify: '联网核实',
      searchEmpty: '没有匹配的歌曲，换个关键词试试。',
      untitled: '未命名',
      sourceSpotify: 'Spotify 收藏',
      sourceDsh: '推荐入库',
      sourceApple: 'Apple Music',
      seekLabel: '播放进度',
      playTrack: '播放这首歌',
      scanFailedHint: '请确认 Host 半已安装并启用（/dsh-music/api/library）。',
      networkError: '无法连接音乐服务，请确认插件 Host 半已启用。',
      audioError: '音频加载失败，文件可能已移动或损坏。',
      lyricsTitle: '歌词',
      lyricsNone: '暂无歌词，仅播放',
      lyricsLoading: '歌词加载中…',
      lyricsError: '歌词加载失败',
      lyricsRetry: '重试',
      lyricsSourceEmbedded: '内嵌标签',
      lyricsSourceLrclib: 'LRCLIB',
      lyricsSourceWeb: '联网补齐',
      lyricsSource: '歌词来源',
      artistOpen: '查看歌手卡片',
      artistIntro: '简介',
      artistNews: '近期动态',
      artistTrivia: '逸闻趣事',
      artistSimilarArtists: '相似歌手',
      artistSimilarSongs: '相似歌曲',
      kindFact: '事实',
      kindRumor: '传闻',
      citeLink: '来源链接',
      citeSource: '来源',
      noSection: '暂无内容',
      statPlays: '播放次数',
      statSeconds: '总时长',
      statSongs: '歌曲数',
      statArtists: '歌手数',
      statSkipped: '跳过次数',
      statCompletion: '平均完整度',
      trendTitle: '近 7 天',
      topSongs: '常听歌曲',
      topUnplayable: '该歌曲当前不在曲库，无法播放',
      topArtists: '常听歌手',
      playsUnit: '次',
      modeOne: '单曲循环',
      modeOrder: '顺序播放',
      modeShuffle: '随机播放',
      hideMini: '隐藏迷你播放条',
      showMini: '显示迷你播放条',
      recoToday: '今日推荐',
      recoArtist: '歌手推荐',
      recoNew: '新歌推荐',
      recoSectionEmpty: '这一栏还没有内容，点「换一批」生成。',
      deleteTrack: '删除',
      revealTrack: '在 Finder 显示',
      deleteConfirm: '从曲库删除这首歌？本地文件会被移除。',
      deleteLikedConfirm: '这是 Spotify 收藏里的歌。删除只会去掉本地文件，不会取消云端收藏。确定继续？',
      deleteLikedConfirm2: '再次确认：本地文件删除后无法从插件恢复。',
      deleteFailed: '删除失败',
      searchTypeSong: '歌曲',
      searchTypeArtist: '歌手',
      searchWebTitle: '网上补全（MusicBrainz）',
      searchNoLocal: '本地曲库没有匹配，可以试试下面的在线补全。',
      styleBtn: '搜风格',
      stylePlaceholder: '描述一种风格，如：深夜爵士 / 粤语经典',
      styleLoading: '正在按风格检索并逐首核实，约需几十秒…',
      styleError: '风格搜索失败',
      styleEmpty: '没有匹配这个风格的已核实歌曲，换个描述试试。',
      interpretedAs: '理解为',
      styleChip: '风格',
      backToReco: '返回推荐',
      colToday: '今日推荐',
      colArtist: '歌手推荐',
      colNew: '新歌推荐',
      playColumn: '播放本栏',
      likeBtn: '喜欢',
      likedBtn: '已喜欢',
      unlikeBtn: '取消喜欢',
      previewLoading: '试听准备中，请稍候…',
      previewFail: '试听失败',
      previewNoVerify: '该曲目缺少核实记录，暂无法试听',
      previewLabel: '试听（不入库）',
      modeHintOne: '单曲循环：反复播放当前这首',
      modeHintOrder: '顺序播放：按队列依次播放',
      modeCycleHint: '点击切换播放模式',
      modeHintShuffle: '随机播放：每轮打乱不重复',
      artistPageBack: '返回推荐',
      artistSongs: '的歌曲',
      artistLoading: '正在打开歌手页…',
      artistError: '歌手页加载失败',
      artistNoSongs: '这位歌手暂时没有已核实的歌曲。',
      miniNeedsTrack: '播放任意歌曲后，这里会出现迷你播放条',
      miniCollapse: '收起',
      miniExpand: '展开',
      miniDrag: '拖动调整位置',
      miniLyrics: '歌词',
      playList: '播放该列表',
      recoGenerate: '生成推荐',
      recoRegenerate: '换一批',
      recoGenerating: '正在生成推荐（每首候选先联网核实，约需半分钟）…',
      recoEmptyTitle: '还没有推荐',
      recoEmptyBody: '基于你的收听历史生成一批 10 首：7 首口味相近 + 3 首强制探索（流派/语言/年代轮换），每首都先联网核实真实存在，杜绝幻觉歌曲。多听几首歌，推荐会更懂你。',
      recoError: '推荐生成失败',
      downloadTitle: '入库队列',
      downloadBtn: '入库',
      downloading: '入库中…',
      downloadDone: '已入库',
      downloadFail: '失败',
      downloadPlay: '已入库，曲库已刷新，可直接播放。',
      downloadError: '入库失败',
      downloadIdle: '暂无入库任务',
      syncBtn: '同步 Spotify',
      syncing: '同步中…',
      syncCloud: '云端收藏',
      syncAdded: '新增入库',
      syncRemoved: '云端移除',
      syncOk: '本地已有',
      syncFail: '失败',
      syncMissing: '本地缺失',
      syncError: '同步失败',
      tabHistory: '历史',
      historyTitle: '收听历史',
      historyEmpty: '还没有播放记录，去曲库放几首歌吧。',
      historyLoading: '历史加载中…',
      historyError: '历史加载失败',
      historySkipped: '跳过',
      historyComplete: '完整度',
      verified: '已核实',
    };
    const en = {
      panel: 'Music',
      welcomeTitle: 'Welcome to dsh-music',
      welcomeSub: 'A local-first music library and recommender. Tell me what you like and I will tune the panel to you.',
      welcomeStart: 'Set it up',
      welcomeSkip: 'Just browse',
      welcomeBack: 'Back to the app',
      welcomePoint1: 'Play your local library with lyrics and artist profiles',
      welcomePoint2: 'Recommendations tuned to your taste; only liked songs are saved',
      welcomePoint3: 'Everything stays on this computer',
      welcomeTasteTitle: 'What do you like to hear?',
      welcomeTasteSub: 'Pick as many as you want, or skip; you can change this later in Recommendations.',
      welcomeGenres: 'Genres',
      welcomeLanguages: 'Languages',
      welcomePrev: 'Back',
      welcomeNext: 'Next',
      welcomeLibTitle: 'Where should we start?',
      welcomeLibSub: 'Already have local music? Pick the first one. Otherwise I prepared a free public-domain starter library.',
      welcomeLocalTitle: 'Use my existing music',
      welcomeLocalBody: 'Scan ~/Music/dsh-music, spotify-liked and other default folders',
      welcomeStarterTitle: 'Use the built-in starter library',
      welcomeStarterBody: 'A few CC0 / public-domain tracks, verified and credited one by one',
      welcomeStarterHint: 'Tracks download one at a time to ~/Music/dsh-music/starter and are added automatically; network failures are skipped, never blocking.',
      welcomeLocalHint: 'The library will be scanned right away and you will land in Library.',
      welcomeFinish: 'Finish',
      welcomeStarterDownloading: 'Preparing the starter library…',
      welcomeStarterReady: 'Starter library is ready',
      welcomeStarterSkipped: 'Network unavailable — starter skipped, explore Recommendations instead',
      welcomeCredits: 'Tracks & licences',
      welcomeEnter: 'Open Recommendations',
      welcomeSaveFail: 'Could not save — please try again',
      welcomePreview: 'Preview welcome',
      genre_jazz: 'Jazz',
      genre_classical: 'Classical',
      genre_electronic: 'Electronic',
      genre_blues: 'Blues',
      genre_reggae: 'Reggae',
      genre_soul: 'Soul',
      genre_folk: 'Folk',
      genre_metal: 'Metal',
      genre_funk: 'Funk',
      genre_ambient: 'Ambient',
      lang_zh: 'Chinese',
      lang_en: 'English',
      lang_yue: 'Cantonese',
      lang_ja: 'Japanese',
      lang_ko: 'Korean',
      lang_fr: 'French',
      lang_es: 'Spanish',
      lang_pt: 'Portuguese',
      lang_it: 'Italian',
      welcomeTasteNote: 'Preferences only bias the discovery batch - nothing is locked, and you can change them any time.',
      welcomePathLabel: 'Music folder (optional)',
      welcomePathPlaceholder: '~/Music/My Music',
      welcomePathHint: 'Leave empty to use the library already scanned; a folder is mounted and rescanned.',

      tabLibrary: 'Library',
      tabReco: 'For You',
      tabNow: 'Now Playing',
      searchPlaceholder: 'Search songs, artists or albums',
      groupNone: 'List',
      groupArtist: 'By artist',
      groupAlbum: 'By album',
      groupLabel: 'Group by',
      rescan: 'Rescan',
      rescanning: 'Scanning…',
      tracksUnit: 'tracks',
      playAll: 'Play all',
      shufflePlay: 'Shuffle',
      loading: 'Scanning your library…',
      loadError: 'Library failed to load',
      retry: 'Retry',
      emptyLibraryTitle: 'Your library is empty',
      emptyLibraryBody: 'Search an artist or song to preview it right away — liked songs are added automatically. Your own music can also go into the scanned folders.',
      emptySearchCta: 'Search to preview',
      emptyAddDirHint: 'Default scanned folders (mp3 / flac / m4a / wav…):',
      emptyRescanCta: 'Rescan library',
      emptyDirNote: 'You can also set custom folders with `directories` in the plugin config.',
      syncOptional: 'Spotify sync (optional)',
      syncOptionalHint: 'Optional: needs the spotify-sync CLI installed; music works without it',
      syncUnavailableHint: 'spotify-sync CLI not found — sync is unavailable (safe to skip)',
      exploreChip: 'Exploration batch',
      recoColdTitle: 'No listening history yet',
      recoColdBody: 'Search and preview some songs first — liked songs are added automatically, and recommendations will follow your taste.',
      unknownAlbum: 'Unknown album',
      unknownArtist: 'Unknown artist',
      nowPlaying: 'Now playing',
      queue: 'Queue',
      queueEmpty: 'The queue is empty — pick a song from the library.',
      noTrackTitle: 'Nothing is playing',
      noTrackBody: 'Pick a song from the library and press play; this becomes your personal deck.',
      goLibrary: 'Open library',
      play: 'Play',
      pause: 'Pause',
      prev: 'Previous',
      next: 'Next',
      shuffle: 'Shuffle',
      shuffleOn: 'Shuffle: on',
      repeat: 'Repeat mode',
      repeatOff: 'Repeat: off',
      repeatAll: 'Repeat: queue',
      repeatOne: 'Repeat: one',
      volume: 'Volume',
      mute: 'Mute',
      unmute: 'Unmute',
      stop: 'Stop and close',
      miniLabel: 'Mini player',
      openNow: 'Open Now Playing',
      playError: 'Playback error',
      recoTitle: 'For You',
      recoBody: 'Built from your listening history, ~10 tracks per batch: 7 close to your taste + 3 forced explorations (genre / language / era rotation plus a wildcard slot) to break the filter bubble.',
      recoNote: 'Every candidate is verified online first and ships with a reason; previews cost no space, and only liked songs land in ~/Music/dsh-music.',
      recoTaste: 'Close to taste',
      recoSimilar: 'Similar',
      recoExplore: 'Forced exploration',
      recoVerify: 'Verified online',
      searchEmpty: 'No matching tracks — try another keyword.',
      untitled: 'Untitled',
      sourceSpotify: 'Spotify liked',
      sourceDsh: 'Recommended',
      sourceApple: 'Apple Music',
      seekLabel: 'Seek',
      playTrack: 'Play this track',
      scanFailedHint: 'Make sure the Host half is installed and enabled (/dsh-music/api/library).',
      networkError: 'Cannot reach the music service. Is the plugin Host half enabled?',
      audioError: 'Audio failed to load; the file may have moved or is corrupt.',
      lyricsTitle: 'Lyrics',
      lyricsNone: 'No lyrics — just play',
      lyricsLoading: 'Loading lyrics…',
      lyricsError: 'Lyrics failed to load',
      lyricsRetry: 'Retry',
      lyricsSourceEmbedded: 'Embedded tags',
      lyricsSourceLrclib: 'LRCLIB',
      lyricsSourceWeb: 'Web lookup',
      lyricsSource: 'Lyrics source',
      artistOpen: 'Open artist card',
      artistIntro: 'Intro',
      artistNews: 'Recent news',
      artistTrivia: 'Trivia',
      artistSimilarArtists: 'Similar artists',
      artistSimilarSongs: 'Similar songs',
      kindFact: 'Fact',
      kindRumor: 'Rumor',
      citeLink: 'Source link',
      citeSource: 'Source',
      noSection: 'Nothing here yet',
      statPlays: 'Plays',
      statSeconds: 'Listening time',
      statSongs: 'Songs',
      statArtists: 'Artists',
      statSkipped: 'Skipped',
      statCompletion: 'Avg completion',
      trendTitle: 'Last 7 days',
      topSongs: 'Most played songs',
      topUnplayable: 'This song is not in your library right now',
      topArtists: 'Most played artists',
      playsUnit: 'plays',
      modeOne: 'Repeat one',
      modeOrder: 'In order',
      modeShuffle: 'Shuffle',
      hideMini: 'Hide mini player',
      showMini: 'Show mini player',
      recoToday: 'Today',
      recoArtist: 'By artist',
      recoNew: 'New',
      recoSectionEmpty: 'Nothing in this section yet. Generate a new batch.',
      deleteTrack: 'Delete',
      revealTrack: 'Show in Finder',
      deleteConfirm: 'Remove this track from the library? The local file will be deleted.',
      deleteLikedConfirm: 'This is a Spotify liked track. Deleting removes only the local file, not the cloud like. Continue?',
      deleteLikedConfirm2: 'Confirm again: the local file cannot be restored from the plugin.',
      deleteFailed: 'Delete failed',
      searchTypeSong: 'Songs',
      searchTypeArtist: 'Artists',
      searchWebTitle: 'Web matches (MusicBrainz)',
      searchNoLocal: 'Nothing local matched — try a web match below.',
      styleBtn: 'Search style',
      stylePlaceholder: 'Describe a vibe, e.g. late-night jazz / cantonese classics',
      styleLoading: 'Searching by style and verifying each track (~tens of seconds)…',
      styleError: 'Style search failed',
      styleEmpty: 'No verified songs match that style — try another description.',
      interpretedAs: 'Understood as',
      styleChip: 'Style',
      backToReco: 'Back to recommendations',
      colToday: 'Today for You',
      colArtist: 'Artists',
      colNew: 'New Finds',
      playColumn: 'Play column',
      likeBtn: 'Like',
      likedBtn: 'Liked',
      unlikeBtn: 'Unlike',
      previewLoading: 'Preparing preview…',
      previewFail: 'Preview failed',
      previewNoVerify: 'This track has no verification record yet — preview unavailable.',
      previewLabel: 'Preview (not added to library)',
      modeHintOne: 'Repeat one: loop the current song',
      modeHintOrder: 'Play in order through the queue',
      modeCycleHint: 'Click to switch play mode',
      modeHintShuffle: 'Shuffle: random each pass, no repeats',
      artistPageBack: 'Back to recommendations',
      artistSongs: 'songs',
      artistLoading: 'Opening artist page…',
      artistError: 'Artist page failed to load',
      artistNoSongs: 'No verified songs for this artist yet.',
      miniNeedsTrack: 'Play any song and the mini player appears here',
      miniCollapse: 'Collapse',
      miniExpand: 'Expand',
      miniDrag: 'Drag to move',
      miniLyrics: 'Lyrics',
      playList: 'Play this list',
      recoGenerate: 'Generate',
      recoRegenerate: 'Another batch',
      recoGenerating: 'Generating recommendations (every candidate is verified online first, ~30s)…',
      recoEmptyTitle: 'No recommendations yet',
      recoEmptyBody: 'We build a batch of 10 from your listening history: 7 close to your taste + 3 forced explorations (genre / language / era rotation), each verified online before it shows up. Play a few more songs and it gets smarter.',
      recoError: 'Recommendations failed',
      downloadTitle: 'Add-to-library queue',
      downloadBtn: 'Add',
      downloading: 'Adding…',
      downloadDone: 'In library',
      downloadFail: 'Failed',
      downloadPlay: 'Added — the library was refreshed; play it from Library.',
      downloadError: 'Could not add to library',
      downloadIdle: 'Nothing queued',
      syncBtn: 'Sync Spotify',
      syncing: 'Syncing…',
      syncCloud: 'Cloud liked',
      syncAdded: 'New songs',
      syncRemoved: 'Removed from cloud',
      syncOk: 'Already local',
      syncFail: 'Failed',
      syncMissing: 'Missing locally',
      syncError: 'Sync failed',
      tabHistory: 'History',
      historyTitle: 'Listening history',
      historyEmpty: 'No plays yet — go play something from the library.',
      historyLoading: 'Loading history…',
      historyError: 'History failed to load',
      historySkipped: 'Skipped',
      historyComplete: 'Completion',
      verified: 'Verified',
    };

    /* ================================================================
     * 2. Small helpers
     * ================================================================ */
    const cx = (...parts) => parts.filter(Boolean).join(' ');

    function formatTime(sec) {
      if (sec == null || !isFinite(sec) || sec < 0) return '--:--';
      const s = Math.floor(sec % 60);
      const m = Math.floor(sec / 60) % 60;
      const hh = Math.floor(sec / 3600);
      const mm = hh > 0 ? String(m).padStart(2, '0') : String(m);
      return (hh > 0 ? hh + ':' : '') + mm + ':' + String(s).padStart(2, '0');
    }

    const baseUrl = typeof document !== 'undefined' ? document.baseURI : '/';
    const resolveUrl = (path) => {
      try {
        // Host convention (agreed with 磐石): JSON carries root-absolute paths,
        // resolved here against the document base with the leading '/' stripped
        // (same rule as the boot graph) so a non-root mount keeps working.
        const rel = String(path).replace(/^\/+/, '');
        return new URL(rel, baseUrl).href;
      } catch { return path; }
    };

    /* Traditional→simplified map (S1-002): covers the characters occurring in
     * this library's song titles so a simplified query matches traditional
     * tags. Search-only normalization, never rewrites displayed text. */
    const T2S = {
      輝:'辉',歲:'岁',軌:'轨',跡:'迹',猶:'犹',闊:'阔',夢:'梦',淚:'泪',橋:'桥',
      牽:'牵',掛:'挂',鴿:'鸽',與:'与',妳:'你',湯:'汤',蹈:'蹈',彎:'弯',呂:'吕',孫:'孙',
      張:'张',學:'学',陳:'陈',葉:'叶',蕭:'萧',許:'许',譚:'谭',鄭:'郑',黃:'黄',盧:'卢',
      愛:'爱',戀:'恋',風:'风',雲:'云',車:'车',馬:'马',鳥:'鸟',語:'语',難:'难',場:'场',
      遊:'游',戲:'戏',傑:'杰',會:'会',執:'执',曖:'暧',無:'无',曉:'晓',濕:'湿',內:'内',
      傷:'伤',癡:'痴',聲:'声',絕:'绝',對:'对',終:'终',雙:'双',發:'发',過:'过',後:'后',
      開:'开',關:'关',門:'门',見:'见',聽:'听',書:'书',畫:'画',樂:'乐',團:'团',隊:'队',
      員:'员',飛:'飞',機:'机',雞:'鸡',鴨:'鸭',魚:'鱼',飯:'饭',麵:'面',藝:'艺',鐘:'钟',
      響:'响',歸:'归',訊:'讯',號:'号',個:'个',們:'们',這:'这',裡:'里',麼:'么',義:'义',
      於:'于',戰:'战',術:'术',補:'补',萬:'万',專:'专',業:'业',歷:'历',動:'动',靜:'静',
      讓:'让',誰:'谁',變:'变',東:'东',兩:'两',嚴:'严',臨:'临',為:'为',蘋:'苹',帶:'带',
      離:'离',雜:'杂',館:'馆',頭:'头',點:'点',廳:'厅',錯:'错',錄:'录',錢:'钱',長:'长',
      時:'时',鏈:'链',閃:'闪',閒:'闲',問:'问',間:'间',誤:'误',悶:'闷',壽:'寿',覺:'觉',覽:'览',觀:'观',
      歡:'欢',殘:'残',湊:'凑',滅:'灭',滿:'满',漸:'渐',燒:'烧',燈:'灯',獨:'独',獲:'获',
      環:'环',種:'种',積:'积',窮:'穷',競:'竞',筆:'笔',築:'筑',簡:'简',類:'类',級:'级',
      練:'练',縣:'县',織:'织',續:'续',經:'经',緣:'缘',編:'编',緩:'缓',縮:'缩',劇:'剧',
      勸:'劝',勝:'胜',務:'务',區:'区',醫:'医',廠:'厂',廢:'废',強:'强',彈:'弹',徹:'彻',
      憶:'忆',懷:'怀',擁:'拥',擊:'击',據:'据',擬:'拟',攝:'摄',敵:'敌',斷:'断',舊:'旧',
      顯:'显',頂:'顶',頓:'顿',頻:'频',顆:'颗',題:'题',顏:'颜',願:'愿',養:'养',餘:'余',
      餵:'喂',馳:'驰',驅:'驱',驚:'惊',癢:'痒',畢:'毕',
    };
    function normalizeZh(s) {
      const lower = String(s || '').toLowerCase();
      let out = '';
      for (const ch of lower) out += T2S[ch] || ch;
      return out;
    }

    function readPrefs() {
      try {
        const raw = localStorage.getItem('dsh-music.prefs');
        return raw ? JSON.parse(raw) : {};
      } catch { return {}; }
    }
    function writePrefs(patch) {
      try {
        localStorage.setItem('dsh-music.prefs', JSON.stringify({ ...readPrefs(), ...patch }));
      } catch { /* private mode etc. — prefs are best-effort */ }
    }

    /** Minimal observable store: getSnapshot + subscribe, immutable updates. */
    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        getSnapshot: () => state,
        subscribe: (fn) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
        set: (patch) => {
          state = { ...state, ...patch };
          for (const fn of [...listeners]) fn();
        },
      };
    }

    /* ================================================================
     * 3. Original icon set (hand-drawn paths, currentColor, 24 viewBox)
     * ================================================================ */
    function makeIcon(nodes, defaults) {
      return function Icon({ size = 18, style, className } = {}) {
        return h('svg', {
          viewBox: '0 0 24 24', width: size, height: size,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
          strokeLinecap: 'round', strokeLinejoin: 'round',
          'aria-hidden': true, focusable: false, style, className,
          ...defaults,
        }, nodes.map((n, i) => h(n[0], { key: i, ...n[1] })));
      };
    }
    const FILLED = { fill: 'currentColor', stroke: 'none' };

    const IconNote = makeIcon([
      ['path', { d: 'M9 18V5l10-2v13' }],
      ['circle', { cx: 6.5, cy: 18, r: 2.5 }],
      ['circle', { cx: 16.5, cy: 16, r: 2.5 }],
    ]);
    const IconPlay = makeIcon([['path', { d: 'M8 5.4v13.2L19 12z', ...FILLED }]]);
    const IconPause = makeIcon([
      ['rect', { x: 7, y: 5, width: 3.4, height: 14, rx: 1.1, ...FILLED }],
      ['rect', { x: 13.6, y: 5, width: 3.4, height: 14, rx: 1.1, ...FILLED }],
    ]);
    const IconPrev = makeIcon([
      ['path', { d: 'M18.5 6v12L10 12z', ...FILLED }],
      ['path', { d: 'M6.5 5.5v13', strokeWidth: 2.2 }],
    ]);
    const IconNext = makeIcon([
      ['path', { d: 'M5.5 6v12L14 12z', ...FILLED }],
      ['path', { d: 'M17.5 5.5v13', strokeWidth: 2.2 }],
    ]);
    const IconShuffle = makeIcon([
      ['path', { d: 'M3 7h3.4c1.5 0 2.9.7 3.8 1.9l4.2 6.2c.9 1.2 2.3 1.9 3.8 1.9H21' }],
      ['path', { d: 'M3 17h3.4c1.5 0 2.9-.7 3.8-1.9l.8-1.2' }],
      ['path', { d: 'M14.1 8.8l.8-1.1C15.8 6.5 17.2 5.8 18.7 5.8H21' }],
      ['path', { d: 'M18.5 3.3 21.5 5.8 18.5 8.3' }],
      ['path', { d: 'M18.5 14.5 21.5 17 18.5 19.5' }],
    ]);
    const IconRepeat = makeIcon([
      ['path', { d: 'M17 2.8 20.4 6.2 17 9.6' }],
      ['path', { d: 'M3.6 11.2V9.6a3.4 3.4 0 0 1 3.4-3.4h13.4' }],
      ['path', { d: 'M7 21.2 3.6 17.8 7 14.4' }],
      ['path', { d: 'M20.4 12.8v1.6a3.4 3.4 0 0 1-3.4 3.4H3.6' }],
    ]);
    const IconRepeatOne = makeIcon([
      ['path', { d: 'M17 2.8 20.4 6.2 17 9.6' }],
      ['path', { d: 'M3.6 11.2V9.6a3.4 3.4 0 0 1 3.4-3.4h13.4' }],
      ['path', { d: 'M7 21.2 3.6 17.8 7 14.4' }],
      ['path', { d: 'M20.4 12.8v1.6a3.4 3.4 0 0 1-3.4 3.4H3.6' }],
      ['path', { d: 'M11.2 10.4l1.4-.9V15', strokeWidth: 1.6 }],
    ]);
    const IconVolume = makeIcon([
      ['path', { d: 'M4 9.5v5h3.5L12 18.6V5.4L7.5 9.5z', ...FILLED }],
      ['path', { d: 'M15.5 9.2a4.1 4.1 0 0 1 0 5.6' }],
      ['path', { d: 'M18.2 6.6a7.9 7.9 0 0 1 0 10.8' }],
    ]);
    const IconMute = makeIcon([
      ['path', { d: 'M4 9.5v5h3.5L12 18.6V5.4L7.5 9.5z', ...FILLED }],
      ['path', { d: 'M16 9.5l5 5M21 9.5l-5 5' }],
    ]);
    const IconSearch = makeIcon([
      ['circle', { cx: 11, cy: 11, r: 6.5 }],
      ['path', { d: 'M15.8 15.8 20.5 20.5' }],
    ]);
    const IconRefresh = makeIcon([
      ['path', { d: 'M20 12a8 8 0 1 1-2.34-5.66' }],
      ['path', { d: 'M20.4 2.8v4h-4' }],
    ]);
    const IconClose = makeIcon([['path', { d: 'M6 6l12 12M18 6 6 18' }]]);
    const IconChevronDown = makeIcon([['path', { d: 'M6 9.5l6 6 6-6' }]]);
    const IconChevronUp = makeIcon([['path', { d: 'M6 14.5l6-6 6 6' }]]);
    const IconGrip = makeIcon([
      ['path', { d: 'M9 7.2h.1M15 7.2h.1M9 12h.1M15 12h.1M9 16.8h.1M15 16.8h.1', strokeWidth: 2.6 }],
    ]);
    const IconSparkles = makeIcon([
      ['path', { d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z' }],
      ['path', { d: 'M18.6 15.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z' }],
    ]);
    const IconCheck = makeIcon([['path', { d: 'M5 12.5l4.4 4.4L19 7' }]]);
    const IconFolder = makeIcon([
      ['path', { d: 'M4 6.8A1.8 1.8 0 0 1 5.8 5h3.1l1.8 2.1h7.5A1.8 1.8 0 0 1 20 8.9v8.3a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 17.2z' }],
    ]);
    const IconDisc = makeIcon([
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['circle', { cx: 12, cy: 12, r: 2.4 }],
    ]);
    const IconAlert = makeIcon([
      ['circle', { cx: 12, cy: 12, r: 8.6 }],
      ['path', { d: 'M12 7.6v5.2M12 16.4v.1' }],
    ]);
    const IconQueue = makeIcon([['path', { d: 'M4 6.5h16M4 12h16M4 17.5h10' }]]);
    const IconDownload = makeIcon([
      ['path', { d: 'M12 4v10' }],
      ['path', { d: 'M8 10.5 12 14.5 16 10.5' }],
      ['path', { d: 'M5 18.5h14' }],
    ]);
    const IconHeart = makeIcon([
      ['path', { d: 'M12 20s-7.4-4.6-9.3-9C1.4 7.6 3.4 4.5 6.6 4.5c2 0 3.4 1.1 4.2 2.4l1.2 2 1.2-2c.8-1.3 2.2-2.4 4.2-2.4 3.2 0 5.2 3.1 3.9 6.5-1.9 4.4-9.3 9-9.3 9z' }],
    ], { 'data-heart': 1 });

    /* ================================================================
     * 4. Styles — every color is a host theme token (--dsw-alias-*)
     * ================================================================ */
    const CSS = `
.dshm-panel{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;}
.dshm-welcome{position:relative;height:100%;display:flex;align-items:center;justify-content:center;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;animation:dshm-fade-in .28s ease-out;}
.dshm-welcome-inner{position:relative;width:min(540px,calc(100% - 48px));padding:32px 0;text-align:center;}
.dshm-welcome-preview .dshm-wclose{position:absolute;right:0;top:6px;appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;}
.dshm-welcome-preview .dshm-wclose:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-welcome-hero{position:relative;}
.dshm-welcome-glow{position:absolute;left:50%;top:0;width:330px;height:300px;transform:translateX(-50%);border-radius:50%;background:radial-gradient(circle,var(--dsw-alias-brand-primary),transparent 70%);opacity:.16;filter:blur(18px);pointer-events:none;}
.dshm-welcome-fish{position:relative;display:flex;justify-content:center;animation:dshm-float 4.5s ease-in-out infinite;}
.dshm-welcome-title{font-size:26px;font-weight:700;margin:12px 0 6px;letter-spacing:-.2px;}
.dshm-welcome-sub{color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.65;max-width:430px;margin:0 auto;}
.dshm-welcome-actions{display:flex;gap:10px;justify-content:center;margin-top:22px;flex-wrap:wrap;}
.dshm-wbtn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;padding:9px 18px;border-radius:10px;cursor:pointer;display:inline-flex;align-items:center;gap:7px;transition:background .15s,border-color .15s,transform .15s;}
.dshm-wbtn:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-wbtn:active{transform:translateY(1px);}
.dshm-wbtn:disabled{opacity:.55;cursor:not-allowed;}
.dshm-wbtn-primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-color:transparent;}
.dshm-wbtn-primary:hover{background:var(--dsw-alias-button-primary-hover);}
.dshm-welcome-points{display:flex;flex-direction:column;gap:7px;margin:26px auto 0;width:fit-content;text-align:left;}
.dshm-wpoint{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-label-secondary);font-size:12px;}
.dshm-welcome-panel{width:100%;}
.dshm-wstep-title{font-size:18px;font-weight:650;margin:0 0 6px;}
.dshm-wstep-sub{color:var(--dsw-alias-label-secondary);font-size:12.5px;line-height:1.6;margin:0 auto 18px;max-width:440px;}
.dshm-wgroup{margin:0 0 16px;text-align:left;}
.dshm-wlabel{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);margin-bottom:8px;}
.dshm-wchips{display:flex;flex-wrap:wrap;gap:7px;}
.dshm-wchip{appearance:none;font:inherit;font-size:12px;padding:6px 13px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;transition:background .15s,border-color .15s,color .15s;}
.dshm-wchip:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-wchip-on{background:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-primary-inverted);border-color:transparent;}
.dshm-wcards{display:flex;flex-direction:column;gap:10px;text-align:left;}
.dshm-wcard{appearance:none;font:inherit;display:flex;gap:12px;align-items:flex-start;padding:14px;border-radius:12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;transition:background .15s,border-color .15s,box-shadow .15s;}
.dshm-wcard:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-wcard-on{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 1px var(--dsw-alias-brand-primary) inset;}
.dshm-wcard-icon{flex:none;width:34px;height:34px;border-radius:9px;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-2);}
.dshm-wcard-text{display:flex;flex-direction:column;gap:3px;}
.dshm-wcard-title{font-size:13px;font-weight:600;}
.dshm-wcard-body{font-size:12px;color:var(--dsw-alias-label-secondary);line-height:1.5;}
.dshm-whint{font-size:11.5px;color:var(--dsw-alias-label-secondary);margin:12px 0 0;line-height:1.55;}
.dshm-wpath{text-align:left;margin-top:14px;}
.dshm-winput{width:100%;box-sizing:border-box;font:inherit;font-size:12.5px;padding:9px 11px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);outline:none;transition:border-color .15s;}
.dshm-winput:focus{border-color:var(--dsw-alias-brand-primary);}
.dshm-winput::placeholder{color:var(--dsw-alias-label-tertiary);}
.dshm-whint-err{color:var(--dsw-alias-state-error-primary);}
.dshm-wdots{display:flex;gap:6px;justify-content:center;margin-top:22px;}
.dshm-wdot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-border-l2);transition:all .2s;}
.dshm-wdot-on{background:var(--dsw-alias-brand-primary);width:18px;border-radius:3px;}
.dshm-wprogress{display:flex;align-items:center;gap:10px;margin:4px 0 14px;}
.dshm-wprogress-track{flex:1;height:6px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);overflow:hidden;}
.dshm-wprogress-fill{height:100%;border-radius:99px;background:var(--dsw-alias-brand-primary);transition:width .3s;}
.dshm-wtracks{text-align:left;display:flex;flex-direction:column;gap:5px;margin-bottom:16px;}
.dshm-wtrack{display:flex;align-items:center;gap:8px;font-size:11.5px;color:var(--dsw-alias-label-secondary);}
.dshm-wtrack-lic{margin-left:auto;font-size:10.5px;color:var(--dsw-alias-label-tertiary);flex:none;}
@keyframes dshm-float{0%,100%{transform:translateY(0);}50%{transform:translateY(-7px);}}
@keyframes dshm-fade-in{from{opacity:0;transform:translateY(6px);}to{opacity:1;transform:none;}}
.dshm-panel *{box-sizing:border-box;}
.dshm-header{flex:none;padding:14px 20px 0;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dshm-title-row{display:flex;align-items:center;gap:10px;margin-bottom:14px;}
.dshm-title{font-size:17px;font-weight:650;margin:0;letter-spacing:.2px;}
.dshm-count{color:var(--dsw-alias-label-tertiary);font-size:12px;}
.dshm-header-actions{margin-left:auto;display:flex;gap:8px;align-items:center;}
.dshm-tabs{display:flex;gap:4px;}
.dshm-tab{position:relative;appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;padding:8px 12px 10px;cursor:pointer;border-radius:8px 8px 0 0;display:inline-flex;align-items:center;gap:6px;transition:color .15s;}
.dshm-tab:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);}
.dshm-tab[aria-selected="true"]{color:var(--dsw-alias-brand-text);font-weight:600;}
.dshm-tab[aria-selected="true"]::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px;background:var(--dsw-alias-brand-primary);}
.dshm-tab-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-brand-primary);animation:dshm-pulse 1.6s ease-in-out infinite;}
.dshm-body{flex:1;min-height:0;display:flex;flex-direction:column;container-type:inline-size;}
.dshm-toolbar{flex:none;display:flex;align-items:center;gap:8px;padding:10px 20px;border-bottom:1px solid var(--dsw-alias-border-l1);flex-wrap:wrap;width:100%;max-width:1120px;margin:0 auto;}
.dshm-search{display:flex;align-items:center;gap:8px;flex:1;min-width:180px;max-width:340px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;color:var(--dsw-alias-label-tertiary);transition:border-color .15s;}
.dshm-search:focus-within{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-label-secondary);}
.dshm-search input{flex:1;min-width:0;border:0;background:transparent;color:var(--dsw-alias-label-primary);font:inherit;outline:none;}
.dshm-search input::placeholder{color:var(--dsw-alias-label-tertiary);}
.dshm-select{appearance:none;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;border-radius:9px;padding:6px 26px 6px 10px;cursor:pointer;outline:none;background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);background-position:calc(100% - 14px) 55%,calc(100% - 9px) 55%;background-size:5px 5px;background-repeat:no-repeat;}
.dshm-select:focus-visible{border-color:var(--dsw-alias-brand-primary);}
.dshm-chipbtn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;border-radius:9px;padding:6px 12px;cursor:pointer;transition:background .15s,color .15s,border-color .15s,transform .1s;}
.dshm-chipbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dshm-chipbtn:active:not(:disabled){transform:scale(.97);}
.dshm-chipbtn:disabled{opacity:.5;cursor:default;}
.dshm-chipbtn-primary{background:var(--dsw-alias-button-primary-fill);border-color:transparent;color:var(--dsw-alias-label-primary-inverted);}
.dshm-chipbtn-primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted);}
.dshm-list{flex:1;min-height:0;overflow-y:auto;padding:6px 16px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:1120px;margin:0 auto;}
.dshm-list::-webkit-scrollbar{width:10px;}
.dshm-list::-webkit-scrollbar-track{background:transparent;}
.dshm-list::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:6px;border:2px solid var(--dsw-alias-bg-base);}
.dshm-list::-webkit-scrollbar-thumb:hover{background:var(--dsw-alias-scrollbar-hover-l2);}
.dshm-group-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:6px;padding:10px 8px 6px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-secondary);font-size:12px;font-weight:600;}
.dshm-group-head .dshm-group-count{color:var(--dsw-alias-label-tertiary);font-weight:400;}
.dshm-row{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto auto 26px;align-items:center;gap:12px;padding:7px 8px;border-radius:10px;cursor:pointer;transition:background .12s;outline:none;}
.dshm-row-actions{display:flex;gap:2px;opacity:0;}
.dshm-row:hover .dshm-row-actions,.dshm-row:focus-within .dshm-row-actions{opacity:1;}
.dshm-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-row:focus-visible{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}
.dshm-row-current{background:var(--dsw-alias-interactive-bg-active);}
.dshm-row-current .dshm-row-title{color:var(--dsw-alias-brand-text);}
.dshm-row-info{min-width:0;}
.dshm-row-title{display:flex;align-items:center;gap:7px;font-size:13px;font-weight:520;color:var(--dsw-alias-label-primary);}
.dshm-row-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}
.dshm-row-dur{font-size:11.5px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;}
.dshm-row-play{display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-secondary);opacity:0;transition:opacity .12s;}
.dshm-row:hover .dshm-row-play,.dshm-row:focus-visible .dshm-row-play{opacity:1;}
.dshm-row-current .dshm-row-play{opacity:0;}
.dshm-ellipsis{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;}
.dshm-cover{flex:none;position:relative;border-radius:8px;overflow:hidden;background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-3));display:flex;align-items:center;justify-content:center;border:1px solid var(--dsw-alias-border-l1);}
.dshm-cover img{width:100%;height:100%;object-fit:cover;display:block;}
.dshm-cover-fallback{color:var(--dsw-alias-label-tertiary);display:flex;}
.dshm-eq{display:inline-flex;align-items:flex-end;gap:2px;height:12px;flex:none;}
.dshm-eq i{width:3px;border-radius:1.5px;background:var(--dsw-alias-brand-primary);height:30%;}
.dshm-eq-on i{animation:dshm-eq 1s ease-in-out infinite;}
.dshm-eq-on i:nth-child(2){animation-delay:.25s;}
.dshm-eq-on i:nth-child(3){animation-delay:.5s;}
@keyframes dshm-eq{0%,100%{height:25%;}50%{height:100%;}}
@keyframes dshm-pulse{0%,100%{opacity:1;}50%{opacity:.35;}}
.dshm-iconbtn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary);width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .13s,color .13s,transform .1s;flex:none;padding:0;}
.dshm-iconbtn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);}
.dshm-iconbtn:active:not(:disabled){transform:scale(.92);}
.dshm-iconbtn:disabled{opacity:.4;cursor:default;}
.dshm-iconbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-iconbtn-active{color:var(--dsw-alias-brand-text);}
.dshm-iconbtn-active:hover:not(:disabled){color:var(--dsw-alias-brand-text);}
.dshm-spin{animation:dshm-spin 1s linear infinite;}
@keyframes dshm-spin{to{transform:rotate(360deg);}}
.dshm-state{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 24px;text-align:center;color:var(--dsw-alias-label-secondary);min-height:0;}
.dshm-state-icon{color:var(--dsw-alias-label-tertiary);width:64px;height:64px;border-radius:18px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;margin-bottom:4px;}
.dshm-state-title{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-empty-ctas{display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-top:12px;}
.dshm-empty-dirs{display:flex;flex-direction:column;gap:4px;align-items:flex-start;text-align:left;max-width:440px;margin:14px auto 0;padding:12px 14px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;font-size:12px;color:var(--dsw-alias-label-secondary);}
.dshm-empty-dirs-head{line-height:1.5;}
.dshm-empty-dir{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:5px;padding:1px 6px;}
.dshm-chipbtn-off{opacity:.55;}
.dshm-state-body{font-size:12.5px;line-height:1.7;max-width:420px;color:var(--dsw-alias-label-tertiary);}
.dshm-state-error{color:var(--dsw-alias-state-error-primary);}
.dshm-skel{padding:8px 16px;}
.dshm-skel-row{display:flex;gap:12px;align-items:center;padding:8px;}
.dshm-skel-box{border-radius:8px;background:var(--dsw-alias-bg-skeleton);animation:dshm-pulse 1.4s ease-in-out infinite;}
.dshm-now{flex:1;min-height:0;overflow-y:auto;padding:18px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:980px;margin:0 auto;}
.dshm-now::-webkit-scrollbar{width:10px;}
.dshm-now::-webkit-scrollbar-thumb{background:var(--dsw-alias-scrollbar-bg-l2);border-radius:6px;border:2px solid var(--dsw-alias-bg-base);}
.dshm-now-hero{display:grid;grid-template-columns:240px minmax(0,1fr);gap:28px;align-items:center;max-width:860px;margin:0 auto;}
.dshm-now-cover{width:240px;height:240px;border-radius:16px;box-shadow:0 12px 32px var(--dsw-alias-bg-mask-2);}
.dshm-now-meta{min-width:0;display:flex;flex-direction:column;gap:10px;}
.dshm-now-title{font-size:20px;font-weight:680;margin:0;line-height:1.3;}
.dshm-now-sub{font-size:13px;color:var(--dsw-alias-label-secondary);margin:0;}
.dshm-source-chip{display:inline-flex;align-items:center;gap:5px;align-self:flex-start;font-size:11px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);padding:3px 9px;border-radius:99px;}
.dshm-seekrow{display:flex;align-items:center;gap:10px;margin-top:6px;}
.dshm-time{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;min-width:38px;}
.dshm-time-end{text-align:right;}
.dshm-slider{position:relative;flex:1;height:20px;display:flex;align-items:center;cursor:pointer;touch-action:none;outline:none;min-width:40px;}
.dshm-slider-track{position:relative;width:100%;height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:visible;}
.dshm-slider-fill{position:absolute;left:0;top:0;bottom:0;border-radius:2px;background:var(--dsw-alias-brand-primary);}
.dshm-slider-thumb{position:absolute;top:50%;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-brand-primary);transform:translate(-50%,-50%) scale(0);transition:transform .12s;box-shadow:0 1px 4px var(--dsw-alias-bg-mask-2);}
.dshm-slider:hover .dshm-slider-thumb,.dshm-slider:focus-visible .dshm-slider-thumb,.dshm-slider-drag .dshm-slider-thumb{transform:translate(-50%,-50%) scale(1);}
.dshm-slider:focus-visible .dshm-slider-track{box-shadow:0 0 0 2px var(--dsw-alias-brand-primary);}
.dshm-slider-disabled{opacity:.4;cursor:default;}
.dshm-transport{display:flex;align-items:center;gap:10px;margin-top:4px;}
.dshm-playbtn{width:48px;height:48px;border-radius:50%;border:0;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;transition:background .15s,transform .12s;box-shadow:0 4px 14px var(--dsw-alias-bg-mask-2);flex:none;padding:0;}
.dshm-playbtn:hover{background:var(--dsw-alias-button-primary-hover);transform:scale(1.05);}
.dshm-playbtn:active{transform:scale(.96);}
.dshm-playbtn:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.dshm-volumerow{display:flex;align-items:center;gap:8px;max-width:240px;}
.dshm-volumerow .dshm-slider{flex:1;}
.dshm-volume-pct{font-size:11px;color:var(--dsw-alias-label-tertiary);min-width:32px;font-variant-numeric:tabular-nums;}
.dshm-errorline{display:flex;align-items:center;gap:7px;color:var(--dsw-alias-state-error-primary);font-size:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:8px 12px;}
.dshm-queue{max-width:860px;margin:28px auto 0;}
.dshm-queue-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 8px 8px;border-bottom:1px solid var(--dsw-alias-border-l1);margin-bottom:6px;}
.dshm-queue-head .dshm-count{font-weight:400;}
@container (max-width:680px){
  .dshm-now-hero{grid-template-columns:1fr;justify-items:center;text-align:center;gap:18px;}
  .dshm-now-cover{width:190px;height:190px;}
  .dshm-now-meta{align-items:center;width:100%;}
  .dshm-source-chip{align-self:center;}
  .dshm-transport{justify-content:center;}
  .dshm-volumerow{margin:0 auto;}
}
.dshm-mini{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:min(380px,calc(100% - 32px));background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);border-radius:14px;box-shadow:0 10px 30px var(--dsw-alias-bg-mask-2);overflow:hidden;animation:dshm-mini-in .22s ease-out;}
.dshm-mini-fab{position:fixed;right:16px;bottom:16px;z-index:2147483000;width:48px;height:48px;border-radius:50%;padding:0;overflow:hidden;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l2);box-shadow:0 10px 30px var(--dsw-alias-bg-mask-2);cursor:grab;touch-action:none;animation:dshm-mini-in .18s ease-out;}
.dshm-mini-fab:hover{box-shadow:0 12px 34px var(--dsw-alias-bg-mask-2);}
.dshm-mini-fab:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px;}
.dshm-mini-fab-dragging{cursor:grabbing;animation:none;box-shadow:0 16px 40px var(--dsw-alias-bg-mask-2);}
.dshm-mini-fab-badge{position:absolute;right:1px;bottom:1px;width:19px;height:19px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border:2px solid var(--dsw-alias-bg-layer-1);pointer-events:none;}
.dshm-mini-dragging{box-shadow:0 16px 40px var(--dsw-alias-bg-mask-2);transition:none;animation:none;}
@keyframes dshm-mini-in{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:none;}}
.dshm-mini-inner{display:flex;align-items:center;gap:6px;padding:8px 10px 8px 20px;}
.dshm-mini-main{display:flex;align-items:center;gap:10px;flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;padding:2px;border-radius:9px;text-align:left;}
.dshm-mini-main:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-mini-main:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-mini-text{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1;}
.dshm-mini-title{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-mini-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-mini-sub-error{color:var(--dsw-alias-state-error-primary);}
.dshm-mini-grip{position:absolute;left:3px;top:50%;transform:translateY(-50%);width:14px;height:44px;display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);cursor:grab;border-radius:6px;touch-action:none;opacity:.6;}
.dshm-mini-grip:hover,.dshm-mini-grip:focus-visible{opacity:1;background:var(--dsw-alias-interactive-bg-hover);outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-mini-grip:active{cursor:grabbing;}
.dshm-mini-artist{display:inline-flex;align-items:center;gap:4px;max-width:100%;border:0;background:transparent;padding:0;margin:0;font:inherit;font-size:11px;line-height:14px;color:var(--dsw-alias-label-tertiary);cursor:pointer;text-align:left;border-radius:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.dshm-mini-artist:hover{color:var(--dsw-alias-brand-text);text-decoration:underline;}
.dshm-mini-artist:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-mini-seek{padding:0 12px 0 20px;}
.dshm-mini-seek .dshm-slider{height:16px;}
.dshm-mini-lyrics{display:flex;flex-direction:column;gap:1px;padding:2px 14px 8px 20px;overflow:hidden;}
.dshm-mini-lyric{font-size:11.5px;line-height:16px;color:var(--dsw-alias-label-tertiary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;opacity:.5;transition:opacity .25s ease,color .25s ease;}
.dshm-mini-lyric-on{color:var(--dsw-alias-label-primary);opacity:1;font-weight:600;}
.dshm-mode-cycle{min-width:32px;}
.dshm-chipbtn.dshm-mode-cycle{padding:0 9px;}
.dshm-mini-controls{display:flex;align-items:center;gap:2px;flex:none;}
.dshm-mini-play{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);border-radius:50%;width:34px;height:34px;}
.dshm-mini-play:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover);color:var(--dsw-alias-label-primary-inverted);}
.dshm-reco{max-width:560px;margin:0 auto;}
.dshm-reco-tags{display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-top:6px;}
.dshm-reco-tag{font-size:11px;color:var(--dsw-alias-label-secondary);border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:99px;padding:4px 10px;}
.dshm-reco-page{flex:1;min-height:0;overflow-y:auto;padding:12px 20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:1280px;margin:0 auto;}
.dshm-reco-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px;margin-top:14px;}
.dshm-reco-card{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:14px 16px;display:flex;flex-direction:column;gap:8px;transition:border-color .15s,box-shadow .15s;}
.dshm-reco-card:hover{border-color:var(--dsw-alias-border-l3);box-shadow:0 2px 10px var(--dsw-alias-bg-mask-2);}
.dshm-reco-card-head{display:flex;align-items:center;gap:6px;flex-wrap:wrap;}
.dshm-cat-chip{font-size:11px;padding:2px 9px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}
.dshm-cat-explore{color:var(--dsw-alias-brand-text);border-color:var(--dsw-alias-brand-primary);}
.dshm-axis-chip{font-size:11px;padding:2px 9px;border-radius:99px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-tertiary);}
.dshm-reco-title{font-size:13.5px;font-weight:600;color:var(--dsw-alias-label-primary);}
.dshm-reco-sub{font-size:11.5px;color:var(--dsw-alias-label-tertiary);}
.dshm-reco-reason{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary);}
.dshm-reco-foot{margin-top:auto;display:flex;align-items:center;gap:8px;padding-top:4px;}
.dshm-dl{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:6px;}
.dshm-dl-row{display:flex;align-items:center;gap:8px;font-size:12.5px;min-width:0;}
.dshm-dl-dot{width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary);flex:none;}
.dshm-dl-ok{background:var(--dsw-alias-state-success-primary);}
.dshm-dl-fail{background:var(--dsw-alias-state-error-primary);}
.dshm-dl-status{font-size:11px;color:var(--dsw-alias-label-tertiary);flex:none;}
.dshm-dl-bar{height:3px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;margin:2px 0 4px;}
.dshm-dl-bar>div{height:100%;background:var(--dsw-alias-brand-primary);transition:width .4s ease;}
.dshm-sync{margin:12px 24px 0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:12px 16px;display:flex;flex-direction:column;gap:10px;}
.dshm-sync-chips{display:flex;gap:8px;flex-wrap:wrap;}
.dshm-sync-chip{font-size:11.5px;border:1px solid var(--dsw-alias-border-l1);border-radius:99px;padding:4px 12px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);}
.dshm-sync-detail{font-size:11.5px;color:var(--dsw-alias-label-tertiary);line-height:1.7;}
.dshm-hrow{display:grid;grid-template-columns:40px minmax(0,1fr) auto auto auto;gap:10px;align-items:center;padding:6px 8px;border-radius:10px;}
.dshm-hrow-click{cursor:pointer;}
.dshm-hrow-click:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-hrow-click:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-row-sub-btn{appearance:none;background:none;border:0;padding:0;margin:0;cursor:pointer;text-align:left;font-family:inherit;font-size:12px;color:var(--dsw-alias-label-tertiary);max-width:100%;overflow:hidden;display:inline-flex;align-items:center;gap:4px;vertical-align:middle;}
.dshm-row-sub-btn:hover{color:var(--dsw-alias-brand-text);text-decoration:underline;text-underline-offset:3px;}
.dshm-hrow:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-hbar{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-3);overflow:hidden;}
.dshm-hbar>div{height:100%;background:var(--dsw-alias-brand-primary);}
.dshm-hskip{font-size:10.5px;color:var(--dsw-alias-label-tertiary);border:1px solid var(--dsw-alias-border-l2);border-radius:99px;padding:1px 8px;flex:none;}
.dshm-htime{font-size:11px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;}
.dshm-hlist{max-width:960px;margin:0 auto;padding:10px 8px 20px;}
.dshm-explore-chip{flex:none;font-size:11px;font-weight:600;padding:1px 6px;border-radius:99px;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);}
.dshm-explore-note{display:flex;align-items:flex-start;gap:7px;margin:10px 18px 0;padding:8px 11px;border-radius:9px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5;}
.dshm-columns{flex:1;min-height:0;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:0;}
.dshm-column{min-height:0;display:flex;flex-direction:column;border-right:1px solid var(--dsw-alias-border-l1);}
.dshm-column:last-child{border-right:0;}
.dshm-col-head{flex:none;display:flex;align-items:center;gap:8px;padding:12px 14px 8px;}
.dshm-col-title{font-size:13.5px;font-weight:680;color:var(--dsw-alias-label-primary);display:flex;align-items:center;gap:6px;}
.dshm-col-count{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-col-play{margin-left:auto;}
.dshm-col-list{flex:1;min-height:0;overflow-y:auto;padding:2px 8px 16px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.dshm-srow{display:grid;grid-template-columns:38px minmax(0,1fr) auto auto;align-items:center;gap:10px;padding:6px;border-radius:10px;transition:background .12s;}
.dshm-srow:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-srow-main{min-width:0;display:flex;flex-direction:column;gap:1px;border:0;background:transparent;font:inherit;color:inherit;text-align:left;padding:0;cursor:pointer;}
.dshm-srow-title{font-size:12.5px;font-weight:560;color:var(--dsw-alias-label-primary);}
.dshm-srow-sub{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-srow-artist{appearance:none;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer;border-radius:4px;}
.dshm-srow-artist:hover{color:var(--dsw-alias-brand-text);text-decoration:underline;text-underline-offset:3px;}
.dshm-srow-artist:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px;}
.dshm-srow-reason{font-size:10.5px;color:var(--dsw-alias-label-tertiary);line-height:1.5;margin-top:2px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}
.dshm-like-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);width:30px;height:30px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none;transition:transform .12s,color .12s;}
.dshm-like-btn:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover);}
.dshm-like-btn:active{transform:scale(1.18);}
.dshm-like-btn-on{color:var(--dsw-alias-state-error-primary);}
.dshm-playround{appearance:none;border:0;width:30px;height:30px;border-radius:50%;background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;flex:none;transition:background .13s,transform .1s;}
.dshm-playround:hover{background:var(--dsw-alias-button-primary-hover);transform:scale(1.06);}
.dshm-playround:disabled{opacity:.45;cursor:default;transform:none;}
.dshm-tile{border-radius:8px;overflow:hidden;background:linear-gradient(145deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-layer-3));border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary);flex:none;}
.dshm-tile img{width:100%;height:100%;object-fit:cover;display:block;}
.dshm-arow{display:grid;grid-template-columns:44px minmax(0,1fr) 18px;align-items:center;gap:10px;width:100%;padding:6px;border:0;background:transparent;font:inherit;color:inherit;text-align:left;border-radius:10px;cursor:pointer;transition:background .12s;}
.dshm-arow:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-arow-text{display:flex;flex-direction:column;gap:1px;min-width:0;}
.dshm-arow-arrow{color:var(--dsw-alias-label-tertiary);font-size:16px;line-height:1;}
.dshm-apage-banner{position:relative;height:132px;border-radius:16px;overflow:hidden;background:linear-gradient(135deg,var(--dsw-alias-bg-layer-2),var(--dsw-alias-bg-module-platform));margin-bottom:-38px;display:flex;align-items:center;justify-content:flex-end;padding:0 14px;color:var(--dsw-alias-label-tertiary);}
.dshm-apage-banner img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:.85;}
.dshm-apage-banner-mask{position:absolute;inset:0;background:linear-gradient(180deg,transparent 30%,var(--dsw-alias-bg-base));}
.dshm-apage-hero{position:relative;display:flex;align-items:flex-end;gap:16px;margin-bottom:16px;padding:0 8px;}
.dshm-apage-ava-wrap{width:96px;height:96px;border-radius:50%;border:2px solid var(--dsw-alias-bg-base);box-shadow:0 6px 18px var(--dsw-alias-bg-mask-2);overflow:hidden;flex:none;background:var(--dsw-alias-bg-module-platform);}
.dshm-apage-ava-wrap .dshm-tile{width:100%!important;height:100%!important;border:0;border-radius:0;}
.dshm-agrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;padding:4px 6px;}
.dshm-artcard{appearance:none;border:0;background:transparent;font:inherit;color:inherit;display:flex;flex-direction:column;align-items:center;gap:7px;padding:10px 6px;border-radius:12px;cursor:pointer;transition:background .13s;}
.dshm-artcard:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-artcard:hover .dshm-artava{box-shadow:0 4px 14px var(--dsw-alias-bg-mask-2);}
.dshm-artava{width:62px;height:62px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;font-size:22px;font-weight:700;color:var(--dsw-alias-label-secondary);transition:box-shadow .15s;}
.dshm-artname{font-size:12px;font-weight:600;text-align:center;max-width:100%;}
.dshm-arthint{font-size:10.5px;color:var(--dsw-alias-label-tertiary);text-align:center;line-height:1.45;}
.dshm-mode-group{display:inline-flex;align-items:center;gap:2px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:99px;padding:2px;}
.dshm-mode-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);width:30px;height:28px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;}
.dshm-mode-btn:hover{color:var(--dsw-alias-label-primary);}
.dshm-mode-btn-on{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-inverted);}
.dshm-mode-btn-on:hover{color:var(--dsw-alias-label-primary-inverted);}
.dshm-mode-hint{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:6px;}
.dshm-apage{flex:1;min-height:0;overflow-y:auto;padding:16px 20px 28px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;width:100%;max-width:1120px;margin:0 auto;}
.dshm-apage-hero{display:flex;align-items:center;gap:16px;margin-bottom:16px;}
.dshm-apage-ava{width:76px;height:76px;border-radius:50%;background:var(--dsw-alias-bg-module-platform);border:1px solid var(--dsw-alias-border-l2);display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:700;color:var(--dsw-alias-label-secondary);flex:none;}
.dshm-apage-name{font-size:20px;font-weight:700;margin:0;}
@media (max-width:980px){
  .dshm-columns{grid-template-columns:1fr;}
  .dshm-toolbar{padding:10px 12px;}
  .dshm-header{padding:12px 12px 0;}
  .dshm-reco-page{padding:10px 12px;}
  .dshm-apage{padding:14px 12px 24px;}
  .dshm-now{padding:14px 12px;}
  .dshm-column{border-right:0;border-bottom:1px solid var(--dsw-alias-border-l1);max-height:46vh;}
}
.dshm-history-page{width:100%;max-width:960px;margin:0 auto;padding:12px 8px 24px;}
.dshm-stats-wrap{display:flex;flex-direction:column;gap:12px;margin-bottom:8px;}
.dshm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(118px,1fr));gap:8px;}
.dshm-stat{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;min-width:0;}
.dshm-stat-value{font-size:16px;font-weight:700;color:var(--dsw-alias-label-primary);}
.dshm-stat-label{font-size:11px;color:var(--dsw-alias-label-tertiary);margin-top:2px;}
.dshm-trend{background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;}
.dshm-bars{display:flex;align-items:flex-end;gap:6px;height:88px;}
.dshm-bar-col{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:4px;height:100%;min-width:0;}
.dshm-bar{width:100%;max-width:34px;border-radius:6px 6px 2px 2px;background:linear-gradient(180deg,var(--dsw-alias-brand-primary),var(--dsw-alias-bg-layer-3));min-height:3px;}
.dshm-bar-label{font-size:10px;color:var(--dsw-alias-label-tertiary);}
.dshm-tops{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.dshm-top-col{display:flex;flex-direction:column;gap:2px;min-width:0;background:var(--dsw-alias-bg-layer-1);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:10px 12px;}
.dshm-top-row{display:flex;align-items:center;gap:8px;padding:4px 6px;border-radius:8px;font-size:12px;min-width:0;}
.dshm-top-row-click{cursor:pointer;}
.dshm-top-row-click:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-top-row-click:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px;}
.dshm-top-row-artist{appearance:none;border:0;background:transparent;font:inherit;color:inherit;text-align:left;width:100%;cursor:pointer;}
.dshm-top-row-artist:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-top-row-off{opacity:.55;cursor:not-allowed;}
.dshm-top-row-off:hover{background:transparent;}
.dshm-top-row:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-top-rank{width:18px;color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;font-size:11px;flex:none;}
.dshm-hgroup{margin-top:10px;}
.dshm-hgroup-label{position:sticky;top:0;z-index:1;display:flex;align-items:center;gap:8px;padding:6px 8px;background:var(--dsw-alias-bg-base);font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);}
.dshm-hbadge{font-size:10.5px;border-radius:99px;padding:1px 8px;border:1px solid var(--dsw-alias-border-l2);flex:none;font-variant-numeric:tabular-nums;}
.dshm-hbadge-good{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}
.dshm-hbadge-mid{color:var(--dsw-alias-state-warn-primary);border-color:var(--dsw-alias-state-warn-primary);}
.dshm-hbadge-low{color:var(--dsw-alias-label-tertiary);}
@media (max-width:680px){
  .dshm-tops{grid-template-columns:1fr;}
  .dshm-hrow{grid-template-columns:40px minmax(0,1fr) auto;}
  .dshm-hskip,.dshm-htime{display:none;}
}
.dshm-state-spin{animation:dshm-spin 1.4s linear infinite;}
.dshm-toolbar-flat{margin:0;padding:8px 0;border-bottom:0;}
@media (max-width:560px){
  .dshm-hrow{grid-template-columns:40px minmax(0,1fr) auto;}
  .dshm-hbar,.dshm-hskip,.dshm-htime{display:none;}
  .dshm-sync{margin:12px 12px 0;}
  .dshm-reco-page{padding:16px 12px;}
}
.dshm-lyrics{max-width:860px;margin:24px auto 0;display:flex;flex-direction:column;gap:8px;}
.dshm-lyrics-head{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-secondary);padding:0 8px;}
.dshm-lyrics-scroll{position:relative;max-height:300px;overflow-y:auto;padding:4px 8px;display:flex;flex-direction:column;gap:2px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.dshm-lyric-line{padding:5px 10px;border-radius:8px;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.6;transition:color .2s,background .2s;}
.dshm-lyric-line-past{color:var(--dsw-alias-label-secondary);}
.dshm-lyric-line-active{color:var(--dsw-alias-label-primary);font-weight:600;background:var(--dsw-alias-interactive-bg-hover);}
.dshm-plain-lyrics{white-space:pre-wrap;color:var(--dsw-alias-label-secondary);line-height:1.8;padding:6px 10px;font-size:13px;}
.dshm-lyrics-hint{color:var(--dsw-alias-label-tertiary);font-size:12px;padding:6px 10px;}
.dshm-drawer-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-1);z-index:5;}
.dshm-drawer{position:absolute;top:0;right:0;bottom:0;width:min(430px,92%);background:var(--dsw-alias-bg-layer-1);border-left:1px solid var(--dsw-alias-border-l2);box-shadow:-12px 0 32px var(--dsw-alias-bg-mask-2);z-index:6;display:flex;flex-direction:column;animation:dshm-drawer-in .2s ease-out;}
@keyframes dshm-drawer-in{from{opacity:0;transform:translateX(16px);}to{opacity:1;transform:translateX(0);}}
.dshm-drawer-head{flex:none;display:flex;align-items:center;gap:8px;padding:14px 16px;border-bottom:1px solid var(--dsw-alias-border-l1);}
.dshm-drawer-name{font-size:15px;font-weight:650;margin:0;min-width:0;}
.dshm-drawer-body{flex:1;min-height:0;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:20px;scrollbar-width:thin;scrollbar-color:var(--dsw-alias-scrollbar-bg-l2) transparent;}
.dshm-asec{display:flex;flex-direction:column;gap:8px;}
.dshm-asec-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:6px;}
.dshm-acard{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px;}
.dshm-acard-text{font-size:12.5px;line-height:1.7;color:var(--dsw-alias-label-primary);word-break:break-word;}
.dshm-acard-meta{font-size:11px;color:var(--dsw-alias-label-tertiary);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}
.dshm-acard-meta a{color:var(--dsw-alias-link);text-decoration:none;}
.dshm-acard-meta a:hover{text-decoration:underline;}
.dshm-kind-chip{font-size:10px;padding:1px 8px;border-radius:99px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary);}
.dshm-sim{display:flex;flex-direction:column;gap:6px;}
.dshm-sim-chip{display:inline-flex;align-items:center;gap:5px;display:inline-flex;flex-direction:column;align-items:flex-start;gap:2px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);border-radius:10px;padding:7px 12px;font-size:12.5px;color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;font:inherit;}
.dshm-sim-chip:hover{background:var(--dsw-alias-interactive-bg-hover);}
.dshm-sim-chip-reason{font-size:11px;color:var(--dsw-alias-label-tertiary);}
.dshm-artist-btn{appearance:none;background:none;border:0;color:inherit;font:inherit;padding:0;cursor:pointer;text-align:left;display:inline-flex;align-items:center;gap:5px;max-width:100%;vertical-align:middle;}
.dshm-artist-btn:hover{text-decoration:underline;text-underline-offset:3px;}
@media (prefers-reduced-motion:reduce){
  .dshm-eq-on i,.dshm-tab-dot,.dshm-skel-box,.dshm-spin,.dshm-state-spin,.dshm-mini,.dshm-mini-fab,.dshm-drawer,.dshm-welcome,.dshm-welcome-fish{animation:none;}
  .dshm-mini{animation:none;}
  .dshm-row,.dshm-iconbtn,.dshm-chipbtn,.dshm-playbtn,.dshm-slider-thumb,.dshm-mini-progress>div,.dshm-reco-card,.dshm-dl-bar>div,.dshm-like-btn,.dshm-playround,.dshm-artcard,.dshm-mode-btn{transition:none;}
}
`;

    /* ================================================================
     * 5. Host API (same-origin HTTP, agreed contract with the Host half)
     * ================================================================ */
    function createHostApi(t) {
      /* Taste is a soft bias; unknown values are ignored by the host. */
      function tasteQuery(taste) {
        if (!taste || typeof taste !== 'object') return '';
        const genres = (taste.genres || []).filter(Boolean);
        const languages = (taste.languages || []).filter(Boolean);
        const parts = [];
        if (genres.length) parts.push('genres=' + encodeURIComponent(genres.join(',')));
        if (languages.length) parts.push('languages=' + encodeURIComponent(languages.join(',')));
        return parts.length ? '?' + parts.join('&') : '';
      }

      async function request(path, options) {
        let res;
        try {
          res = await fetch(resolveUrl(path), options);
        } catch {
          throw new Error(t('networkError'));
        }
        if (!res.ok) {
          let message = 'HTTP ' + res.status;
          try {
            const body = await res.json();
            if (body && typeof body.error === 'string') message = body.error;
          } catch { /* non-JSON error body */ }
          throw new Error(message);
        }
        return res.json();
      }
      return {
        library: () => request('/dsh-music/api/library'),
        rescan: () => request('/dsh-music/api/rescan', { method: 'POST' }),
        lyrics: (trackId) => request('/dsh-music/api/lyrics?track=' + encodeURIComponent(trackId)),
        artist: (name) => request('/dsh-music/api/artist?name=' + encodeURIComponent(name)),
        artistImage: (name) => request('/dsh-music/api/reco/artist-image?name=' + encodeURIComponent(name)),
        recoSections: (taste) => request('/dsh-music/api/reco/sections' + tasteQuery(taste)),
        deleteTrack: (trackId, confirm) => request('/dsh-music/api/library/delete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId, confirm: !!confirm }),
        }),
        revealTrack: (trackId) => request('/dsh-music/api/library/reveal', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trackId }),
        }),
        reco: (taste) => request('/dsh-music/api/reco' + tasteQuery(taste)),
        recoStatus: () => request('/dsh-music/api/reco/status'),
        download: (items) => request('/dsh-music/api/download', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items }),
        }),
        downloadStatus: () => request('/dsh-music/api/download/status'),
        sync: () => request('/dsh-music/api/sync', { method: 'POST' }),
        syncStatus: () => request('/dsh-music/api/sync/status'),
        syncAvailability: () => request('/dsh-music/api/sync/availability'),
        history: (limit) => request('/dsh-music/api/history?limit=' + (limit || 50)),
        historyStats: () => request('/dsh-music/api/history/stats'),
        onboardingState: () => request('/dsh-music/api/onboarding/state'),
        onboardingComplete: (payload) => request('/dsh-music/api/onboarding/complete', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload || {}),
        }),
        librarySearch: (q, type) => request('/dsh-music/api/library/search?q=' + encodeURIComponent(q) + '&type=' + (type || 'song')),
        recoStyle: (q) => request('/dsh-music/api/reco/style?q=' + encodeURIComponent(q)),
        recoArtist: (name) => request('/dsh-music/api/reco/artist?name=' + encodeURIComponent(name)),
        playback: (patch) => request('/dsh-music/api/playback', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
        }),
        playbackNext: (trackId) => request('/dsh-music/api/playback/next?trackId=' + encodeURIComponent(trackId || '')),
        like: (body) => request('/dsh-music/api/library/like', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }),
        likes: () => request('/dsh-music/api/library/likes'),
        preview: (body) => request('/dsh-music/api/library/preview', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }),
        previewStatus: () => request('/dsh-music/api/library/preview/status'),
      };
    }

    /* ================================================================
     * 6. Library store
     * ================================================================ */
    function createLibrary(api) {
      const store = createStore({ status: 'idle', tracks: [], error: null, scannedAt: 0 });
      let inflight = false;
      async function load(rescan) {
        if (inflight) return;
        inflight = true;
        store.set({ status: 'loading', error: null });
        try {
          const data = rescan ? await api.rescan() : await api.library();
          const tracks = Array.isArray(data && data.tracks) ? data.tracks : [];
          store.set({ status: 'ready', tracks, error: null, scannedAt: (data && data.scannedAt) || Date.now() });
        } catch (err) {
          store.set({ status: 'error', error: (err && err.message) || String(err) });
        } finally {
          inflight = false;
        }
      }
      async function remove(trackId, confirm) {
        await api.deleteTrack(trackId, confirm);
        await load(false);
      }
      return {
        source: store,
        load: () => load(false),
        rescan: () => load(true),
        remove,
        reveal: (trackId) => api.revealTrack(trackId),
        /* 统一搜索：song+artist 两个口径并行，合并去重并打类型标签。 */
        searchRemote: async (q) => {
          const [song, artist] = await Promise.all([
            api.librarySearch(q, 'song').catch(() => ({ local: [], remote: [] })),
            api.librarySearch(q, 'artist').catch(() => ({ local: [], remote: [] })),
          ]);
          const localMap = new Map();
          for (const tr of [...((song && song.local) || []), ...((artist && artist.local) || [])]) {
            if (tr && tr.id && !localMap.has(tr.id)) localMap.set(tr.id, tr);
          }
          const remoteMap = new Map();
          for (const r of (song && song.remote) || []) {
            const k = 'song::' + normalizeZh(r && r.artist) + '::' + normalizeZh(r && r.title);
            if (!remoteMap.has(k)) remoteMap.set(k, { ...r, kind: 'song' });
          }
          for (const r of (artist && artist.remote) || []) {
            const k = 'artist::' + normalizeZh(r && (r.name || r.artist));
            if (!remoteMap.has(k)) remoteMap.set(k, { ...r, kind: 'artist' });
          }
          return { local: [...localMap.values()], remote: [...remoteMap.values()] };
        },
      };
    }

    /* ================================================================
     * 6b. Lyrics + artist services (S2; contract: host/metadata/CONTRACT.md)
     * ================================================================ */
    function createLyricsService(api) {
      const store = createStore({ trackId: null, status: 'idle', data: null, error: null });
      let inflightFor = null;
      async function load(trackId) {
        if (!trackId || inflightFor === trackId) return;
        /* Mini player + now-playing panel both mount for the same track: keep
         * the ready/loading result instead of firing a second request. */
        const cur = store.getSnapshot();
        if (cur.trackId === trackId && (cur.status === 'ready' || cur.status === 'loading')) return;
        inflightFor = trackId;
        store.set({ trackId, status: 'loading', data: null, error: null });
        try {
          const data = await api.lyrics(trackId);
          if (store.getSnapshot().trackId !== trackId) return; // user moved on
          store.set({ status: 'ready', data });
        } catch (err) {
          if (store.getSnapshot().trackId !== trackId) return;
          store.set({ status: 'error', error: (err && err.message) || String(err) });
        } finally {
          if (inflightFor === trackId) inflightFor = null;
        }
      }
      return { source: store, load };
    }

    function createArtistService(api) {
      const store = createStore({ name: null, status: 'idle', data: null, error: null });
      let inflightFor = null;
      async function load(name) {
        if (!name || inflightFor === name) return;
        inflightFor = name;
        store.set({ name, status: 'loading', data: null, error: null });
        try {
          const data = await api.artist(name);
          if (store.getSnapshot().name !== name) return;
          store.set({ status: 'ready', data });
        } catch (err) {
          if (store.getSnapshot().name !== name) return;
          store.set({ status: 'error', error: (err && err.message) || String(err) });
        } finally {
          if (inflightFor === name) inflightFor = null;
        }
      }
      return { source: store, load };
    }

    /* Artist portraits (batch 2, v6): one lightweight image lookup per name.
     * Requests are coalesced in a 150ms window and limited to 3 in flight, so a
     * page that renders 20 artist rows does not fire 20 parallel lookups.
     * Results live in an in-memory map (null = looked up, no image). */
    function createArtistImageService(api) {
      const store = createStore({ images: {} });
      const inflight = new Set();
      const queue = [];
      let timer = null;
      let active = 0;

      function keyOf(name) { return normalizeZh(name).trim(); }

      function pump() {
        while (active < 3 && queue.length) {
          const name = queue.shift();
          const key = keyOf(name);
          if (!key || inflight.has(key) || Object.prototype.hasOwnProperty.call(store.getSnapshot().images, key)) continue;
          inflight.add(key);
          active += 1;
          api.artistImage(name)
            .then((data) => {
              const url = (data && (data.thumbnailUrl || data.imageUrl)) || null;
              store.set({ images: { ...store.getSnapshot().images, [key]: url } });
            })
            .catch(() => { store.set({ images: { ...store.getSnapshot().images, [key]: null } }); })
            .finally(() => {
              inflight.delete(key);
              active -= 1;
              pump();
            });
        }
      }

      function request(name) {
        const key = keyOf(name);
        if (!key || inflight.has(key) || Object.prototype.hasOwnProperty.call(store.getSnapshot().images, key)) return;
        queue.push(name);
        if (!timer) timer = setTimeout(() => { timer = null; pump(); }, 150);
      }

      function reset() { queue.length = 0; if (timer) { clearTimeout(timer); timer = null; } }

      return { source: store, request, reset };
    }

    /* First-run onboarding state (v7): whether the welcome flow was completed,
     * the starter-library provisioning progress, and the taste profile. */
    function createOnboardingService(api) {
      const store = createStore({ status: 'idle', completed: null, mode: null, libraryConfigured: false, libraryPath: null, starter: null, taste: null, error: null });
      let timer = null;
      async function load() {
        try {
          const data = await api.onboardingState();
          const starter = (data && (data.starter || data.starterLibrary)) || null;
          store.set({
            status: 'ready', completed: !!(data && data.completed),
            mode: (data && data.mode) || null,
            libraryConfigured: !!(data && data.libraryConfigured),
            libraryPath: (data && data.libraryPath) || null,
            starter, taste: (data && data.taste) || null, error: null,
          });
          return data;
        } catch (err) {
          store.set({ status: 'error', error: (err && err.message) || String(err) });
          return null;
        }
      }
      async function complete(payload) {
        await api.onboardingComplete(payload);
        writePrefs({
          taste: (payload && payload.taste) || null,
          libraryMode: (payload && payload.libraryMode) || null,
        });
        store.set({ completed: true, taste: (payload && payload.taste) || null });
        pollStarter();
      }
      function pollStarter() {
        if (timer) return;
        const tick = async () => {
          const data = await load();
          const st = data && ((data.starter || data.starterLibrary) || null);
          if (!st || st.status !== 'downloading') { timer = null; return; }
          timer = setTimeout(tick, 1500);
        };
        timer = setTimeout(tick, 800);
      }
      function dispose() { if (timer) { clearTimeout(timer); timer = null; } }
      return { source: store, load, complete, pollStarter, dispose };
    }

    /* ================================================================
     * 6c. S3 services: recommendations / downloads / sync / history
     * ================================================================ */
    function createRecoService(api) {
      const store = createStore({ status: 'idle', items: [], sections: null, generatedAt: 0, stats: null, error: null, bootstrapNote: null });
      let inflight = false;
      async function pollUntilIdle() {
        for (;;) {
          try {
            const s = await api.recoStatus();
            if (!s || !s.running) return s || null;
          } catch { return null; }
          await new Promise((resolve) => setTimeout(resolve, 2000));
        }
      }
      async function generate() {
        if (inflight) return;
        inflight = true;
        store.set({ status: 'generating', error: null });
        try {
          const data = await api.reco(readPrefs().taste || null);
          store.set({
            status: 'ready', items: (data && data.items) || [], generatedAt: (data && data.generatedAt) || Date.now(),
            stats: (data && data.stats) || null,
            bootstrapNote: data && data.bootstrap ? (data.note || null) : null,
          });
        } catch (err) {
          const msg = (err && err.message) || String(err);
          // BUSY (409): someone else is generating — follow the status endpoint.
          if (msg.indexOf('409') >= 0 || msg.indexOf('生成中') >= 0 || msg.indexOf('正在生成') >= 0) {
            const s = await pollUntilIdle();
            if (s && s.items && s.items.length) {
              store.set({ status: 'ready', items: s.items, generatedAt: s.generatedAt || Date.now(), stats: s.stats || null });
            } else {
              store.set({ status: 'error', error: msg });
            }
          } else {
            store.set({ status: 'error', error: msg });
          }
        } finally {
          inflight = false;
        }
      }
      async function loadSections() {
        if (!api.recoSections) return false;
        try {
          const data = await api.recoSections(readPrefs().taste || null);
          if (!data) return false;
          const sections = {
            today: data.today || [],
            artist: data.artist || [],
            new: data.new || data['new'] || [],
          };
          if (!sections.today.length && !sections.artist.length && !sections.new.length) return false;
          store.set({
            status: 'ready', sections, items: sections.today, generatedAt: data.generatedAt || Date.now(),
            error: null, bootstrapNote: data.exploreOnly ? (data.note || null) : null,
          });
          return true;
        } catch { return false; }
      }
      async function load() {
        if (inflight || store.getSnapshot().status === 'generating') return;
        if (await loadSections()) return;
        try {
          const s = await api.recoStatus();
          if (s && s.running) { generate(); return; }
          if (s && s.items && s.items.length) {
            store.set({ status: 'ready', items: s.items, generatedAt: s.generatedAt || Date.now(), stats: s.stats || null });
          }
        } catch { /* keep empty CTA; user can still generate */ }
      }
      return { source: store, generate, load, searchStyle: (q) => api.recoStyle(q), artistPage: (name) => api.recoArtist(name) };
    }

    function createDownloadService(api) {
      const store = createStore({ running: false, total: 0, done: 0, items: [], error: null, finishedAt: 0 });
      let timer = null;
      async function refresh() {
        try {
          const s = await api.downloadStatus();
          store.set({ running: !!s.running, total: s.total || 0, done: s.done || 0, items: s.items || [] });
          return s;
        } catch { return null; }
      }
      function poll() {
        if (timer) return;
        const tick = async () => {
          const s = await refresh();
          if (s && !s.running) {
            timer = null;
            if (s.total > 0) store.set({ finishedAt: Date.now() });
            return;
          }
          timer = setTimeout(tick, 1500);
        };
        tick();
      }
      async function start(items) {
        try {
          await api.download(items);
          store.set({ error: null, finishedAt: 0 });
        } catch (err) {
          store.set({ error: (err && err.message) || String(err) });
          return false;
        }
        poll();
        return true;
      }
      async function warm() { const s = await refresh(); if (s && s.running) poll(); }
      function dispose() { if (timer) { clearTimeout(timer); timer = null; } }
      return { source: store, start, warm, dispose };
    }

    function createSyncService(api) {
      const store = createStore({ phase: 'idle', result: null, error: null, available: null, hint: null });
      let timer = null;
      /* Host probe endpoint: sync is optional, so a failed probe means "unavailable". */
      async function probe() {
        try {
          const a = await api.syncAvailability();
          store.set({ available: !!(a && a.available), hint: (a && a.hint) || null });
        } catch {
          store.set({ available: false, hint: null });
        }
      }
      function noteAvailable(s) {
        if (s && typeof s.available === 'boolean') store.set({ available: s.available, hint: s.hint || null });
      }
      async function refresh() {
        try {
          const s = await api.syncStatus();
          noteAvailable(s);
          if (s.running) { store.set({ phase: 'running' }); return true; }
          if (s.result || s.error) {
            store.set({ phase: 'done', result: s.result || null, error: s.error || null });
            return false;
          }
          return false;
        } catch { return false; }
      }
      function poll() {
        if (timer) return;
        const tick = async () => {
          const running = await refresh();
          if (!running) { timer = null; return; }
          timer = setTimeout(tick, 1500);
        };
        tick();
      }
      async function start() {
        if (store.getSnapshot().phase === 'running') return;
        store.set({ phase: 'running', error: null, result: null });
        try {
          await api.sync();
        } catch (err) {
          store.set({ phase: 'error', error: (err && err.message) || String(err) });
          timer = null;
          return;
        }
        poll();
      }
      async function warm() { await probe(); const r = await refresh(); if (r) poll(); }
      function dispose() { if (timer) { clearTimeout(timer); timer = null; } }
      return { source: store, start, warm, dispose, probe };
    }

    function createHistoryService(api) {
      const store = createStore({ status: 'idle', events: [], total: 0, stats: null, error: null });
      async function load(limit) {
        store.set({ status: store.getSnapshot().events.length ? 'ready' : 'loading', error: null });
        const statsPromise = api.historyStats
          ? api.historyStats().catch(() => null)
          : Promise.resolve(null);
        try {
          const data = await api.history(limit || 50);
          const stats = await statsPromise;
          store.set({
            status: 'ready',
            events: (data && data.events) || [],
            total: (data && data.total) || 0,
            stats,
          });
        } catch (err) {
          store.set({ status: 'error', error: (err && err.message) || String(err) });
        }
      }
      return { source: store, load };
    }

    /* ================================================================
     * 6d. V3 services: likes (♥才入库) + preview (试听不入库)
     * ================================================================ */
    function likeKey(o) {
      return normalizeZh(o.artist) + '::' + normalizeZh(o.title);
    }

    function createLikesService(api, onAutoDownload) {
      const store = createStore({ keys: {}, loaded: false, error: null });
      async function load() {
        try {
          const data = await api.likes();
          const keys = {};
          for (const it of (data && data.items) || []) if (it.liked !== false) keys[likeKey(it)] = it;
          store.set({ keys, loaded: true, error: null });
        } catch (err) {
          store.set({ loaded: true, error: (err && err.message) || String(err) });
        }
      }
      async function toggle(item, liked) {
        const body = item.id
          ? { trackId: item.id, liked }
          : { artist: item.artist, title: item.title, album: item.album, durationMs: item.durationMs, coverUrl: item.coverUrl, verification: item.verification, liked };
        let res = null;
        try { res = await api.like(body); } catch (err) { return { error: (err && err.message) || String(err) }; }
        const key = likeKey(res && res.key ? { artist: res.key.split('::')[0], title: res.key.split('::')[1] } : item);
        const keys = { ...store.getSnapshot().keys };
        if (liked) keys[key] = { artist: item.artist, title: item.title, trackId: res && res.trackId, inLibrary: res && res.inLibrary };
        else delete keys[key];
        store.set({ keys });
        if (res && res.downloading && onAutoDownload) onAutoDownload();
        return res || {};
      }
      function isLiked(item) {
        return !!store.getSnapshot().keys[likeKey(item)];
      }
      load();
      return { source: store, toggle, isLiked, load };
    }

    function createPreviewService(api) {
      const store = createStore({ status: 'idle', item: null, error: null });
      let timer = null;
      function stopTimer() { if (timer) { clearTimeout(timer); timer = null; } }
      function poll(ready) {
        stopTimer();
        timer = setTimeout(async () => {
          try {
            const s = await api.previewStatus();
            if (s && s.status === 'ready' && s.audioUrl) { store.set({ status: 'idle', item: null }); ready({ audioUrl: s.audioUrl }); return; }
            if (s && s.status === 'fail') { store.set({ status: 'idle', item: null, error: s.error || null }); ready({ error: s.error || '试听失败' }); return; }
            if (s && (s.status === 'downloading' || s.running)) { poll(ready); return; }
          } catch { /* transient — keep polling a bit */ }
          poll(ready);
        }, 2000);
      }
      async function start(item, ready) {
        const snap = store.getSnapshot();
        if (snap.item && snap.item.artist === item.artist && snap.item.title === item.title) return;
        store.set({ status: 'downloading', item, error: null });
        try {
          const res = await api.preview({
            artist: item.artist, title: item.title, album: item.album,
            durationMs: item.durationMs, coverUrl: item.coverUrl, verification: item.verification,
          });
          if (res && res.status === 'ready' && res.audioUrl) {
            store.set({ status: 'idle', item: null });
            ready({ audioUrl: res.audioUrl });
          } else {
            poll(ready);
          }
        } catch (err) {
          store.set({ status: 'idle', item: null, error: (err && err.message) || String(err) });
          ready({ error: (err && err.message) || String(err) });
        }
      }
      function dispose() { stopTimer(); }
      return { source: store, start, dispose };
    }

    /* ================================================================
     * 7. Player engine — singleton audio, survives panel navigation
     * ================================================================ */
    function createPlayer(t, api) {
      const prefs = readPrefs();
      const store = createStore({
        track: null,
        playing: false,
        loading: false,
        position: 0,
        duration: 0,
        volume: typeof prefs.volume === 'number' ? Math.min(1, Math.max(0, prefs.volume)) : 0.9,
        muted: !!prefs.muted,
        queue: [],
        queueIndex: -1,
        shuffle: !!prefs.shuffle,
        repeat: prefs.repeat === 'all' || prefs.repeat === 'one' ? prefs.repeat : 'off',
        error: null,
      });

      const hasAudio = typeof Audio !== 'undefined';
      const audio = hasAudio ? new Audio() : null;
      const cleanups = [];
      if (audio) {
        audio.preload = 'auto';
        audio.volume = store.getSnapshot().volume;
        audio.muted = store.getSnapshot().muted;
      }

      const set = (patch) => store.set(patch);
      const snap = () => store.getSnapshot();

      /* S3 listening history: fire-and-forget report on natural track end
       * (skipped=false) and manual switches (skipped=true). Values are read
       * synchronously before any state change; failures never affect playback. */
      /* Preview tracks carry a synthetic "preview:" id — never report them to
       * history or push them into the Host playback queue (S1-003 validates
       * real library ids only). */
      function isLibraryId(id) {
        return typeof id === 'string' && /^[0-9a-f]{8,}$/.test(id);
      }

      function report(track, skipped) {
        if (!track || !track.id || !isLibraryId(track.id)) return;
        const s = snap();
        const completion = s.duration > 0
          ? Math.min(1, Math.max(0, s.position / s.duration))
          : 0;
        try {
          void fetch(resolveUrl('/dsh-music/api/history'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ trackId: track.id, completion, skipped }),
          }).catch(() => { /* best-effort */ });
        } catch { /* best-effort */ }
      }

      function listen(target, name, fn) {
        target.addEventListener(name, fn);
        cleanups.push(() => target.removeEventListener(name, fn));
      }

      function updateMediaSession(track) {
        try {
          if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
          const ms = navigator.mediaSession;
          ms.metadata = new MediaMetadata({
            title: track.title || '',
            artist: track.artist || '',
            album: track.album || '',
            artwork: track.coverUrl ? [{ src: resolveUrl(track.coverUrl) }] : [],
          });
        } catch { /* MediaSession unsupported — playback still works */ }
      }

      function loadTrack(track, autoplay) {
        if (!audio) return;
        set({ track, error: null, loading: true, position: 0, duration: track.duration || 0 });
        updateMediaSession(track);
        audio.src = resolveUrl(track.audioUrl);
        audio.load();
        if (autoplay) {
          const p = audio.play();
          if (p && p.catch) p.catch((err) => {
            if (err && err.name === 'AbortError') return; // superseded by a newer load
            set({ playing: false, loading: false, error: t('audioError') });
          });
        }
      }

      function hostMode() {
        const s = snap();
        return s.shuffle ? 'shuffle' : s.repeat === 'one' ? 'single' : 'sequential';
      }

      function syncHost(extra) {
        if (!api || !api.playback) return;
        const s = snap();
        const patch = {
          mode: hostMode(),
          trackId: s.track && isLibraryId(s.track.id) ? s.track.id : null,
          queue: (s.queue || []).map((tr) => tr && tr.id).filter((id) => id && isLibraryId(id)),
          ...extra,
        };
        api.playback(patch).catch(() => { /* Host not installed yet — local playback still works */ });
      }

      function playTracks(tracks, startIndex, opts) {
        const list = (tracks || []).filter((tr) => tr && tr.audioUrl);
        if (!list.length) return;
        if (snap().track) report(snap().track, true);
        /* D1：播放全部必须跟随当前模式——随机态先打乱队列再随机起播，
         * 顺序/单曲态从首曲开始（单曲由 repeat=one 循环当前首）。 */
        const wantShuffle = opts && typeof opts.shuffle === 'boolean' ? opts.shuffle : snap().shuffle;
        let queue = list;
        let index = Math.min(Math.max(0, startIndex | 0), list.length - 1);
        if (wantShuffle && queue.length > 1) {
          queue = [...list];
          for (let i = queue.length - 1; i > 0; i -= 1) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = queue[i];
            queue[i] = queue[j];
            queue[j] = tmp;
          }
          index = Math.floor(Math.random() * queue.length);
        }
        set({ queue, queueIndex: index, shuffle: wantShuffle });
        if (opts && typeof opts.shuffle === 'boolean') writePrefs({ shuffle: wantShuffle });
        loadTrack(queue[index], true);
        syncHost({ trackId: queue[index].id, queue: queue.map((tr) => tr.id).filter(Boolean) });
      }

      function jumpTo(index) {
        const { queue } = snap();
        if (index < 0 || index >= queue.length) return;
        report(snap().track, true);
        set({ queueIndex: index });
        loadTrack(queue[index], true);
        syncHost({ trackId: queue[index].id });
      }

      function playById(id) {
        const { queue } = snap();
        const idx = queue.findIndex((tr) => tr && tr.id === id);
        if (idx < 0) return false;
        set({ queueIndex: idx });
        loadTrack(queue[idx], true);
        syncHost({ trackId: id });
        return true;
      }

      function advanceLocal(auto) {
        const { queue, queueIndex, shuffle, repeat } = snap();
        if (!queue.length) return;
        if (auto && repeat === 'one') {
          if (audio) { audio.currentTime = 0; const p = audio.play(); if (p && p.catch) p.catch(() => {}); }
          return;
        }
        let next;
        if (shuffle && queue.length > 1) {
          do { next = Math.floor(Math.random() * queue.length); } while (next === queueIndex);
        } else {
          next = queueIndex + 1;
          if (next >= queue.length) {
            if (repeat === 'all' || !auto) next = 0;
            else { set({ playing: false }); return; }
          }
        }
        set({ queueIndex: next });
        loadTrack(queue[next], true);
        syncHost({ trackId: queue[next].id });
      }

      async function advance(auto) {
        const cur = snap().track;
        if (cur) report(cur, !auto);
        if (auto && cur && api && api.playbackNext) {
          try {
            const data = await api.playbackNext(cur.id);
            if (!data || !data.trackId) { set({ playing: false }); return; }
            if (data.reason === 'replay' || data.trackId === cur.id) {
              if (audio) { audio.currentTime = 0; const p = audio.play(); if (p && p.catch) p.catch(() => {}); }
              return;
            }
            if (playById(data.trackId)) return;
          } catch { /* Host unavailable — local decision below */ }
        }
        advanceLocal(auto);
      }

      function prev() {
        const { queue, queueIndex, shuffle, position } = snap();
        if (!queue.length) return;
        if (position > 3 && audio) { audio.currentTime = 0; set({ position: 0 }); return; }
        report(snap().track, true);
        let index;
        if (shuffle && queue.length > 1) {
          do { index = Math.floor(Math.random() * queue.length); } while (index === queueIndex);
        } else {
          index = queueIndex - 1;
          if (index < 0) index = queue.length - 1;
        }
        set({ queueIndex: index });
        loadTrack(queue[index], true);
      }

      function toggle() {
        if (!audio || !snap().track) return;
        if (snap().playing) audio.pause();
        else {
          const p = audio.play();
          if (p && p.catch) p.catch((err) => {
            if (err && err.name === 'AbortError') return;
            set({ error: t('audioError'), playing: false });
          });
        }
      }

      function seek(seconds) {
        if (!audio || !snap().track) return;
        const dur = snap().duration;
        const target = Math.min(Math.max(0, seconds), dur > 0 ? dur : seconds);
        try { audio.currentTime = target; } catch { /* not seekable yet */ }
        set({ position: target });
      }

      function setVolume(v) {
        const volume = Math.min(1, Math.max(0, v));
        if (audio) { audio.volume = volume; if (volume > 0 && audio.muted) { audio.muted = false; set({ muted: false }); } }
        set({ volume });
        writePrefs({ volume });
      }

      function toggleMute() {
        const muted = !snap().muted;
        if (audio) audio.muted = muted;
        set({ muted });
        writePrefs({ muted });
      }

      function setMode(mode) {
        const next = mode === 'one'
          ? { shuffle: false, repeat: 'one' }
          : mode === 'shuffle'
            ? { shuffle: true, repeat: 'all' }
            : { shuffle: false, repeat: 'all' };
        set(next);
        writePrefs(next);
        syncHost({ mode: mode === 'one' ? 'single' : mode === 'shuffle' ? 'shuffle' : 'sequential' });
      }

      function cycleMode() {
        const s = snap();
        const cur = s.shuffle ? 'shuffle' : s.repeat === 'one' ? 'one' : 'order';
        setMode(cur === 'order' ? 'shuffle' : cur === 'shuffle' ? 'one' : 'order');
      }

      function stop() {
        if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
        set({ track: null, playing: false, loading: false, position: 0, duration: 0, queue: [], queueIndex: -1, error: null });
        try { if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) navigator.mediaSession.metadata = null; } catch { /* ignore */ }
      }

      if (audio) {
        listen(audio, 'timeupdate', () => {
          const patch = { position: audio.currentTime };
          if (isFinite(audio.duration) && audio.duration > 0 && audio.duration !== snap().duration) patch.duration = audio.duration;
          set(patch);
        });
        listen(audio, 'loadedmetadata', () => {
          if (isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
        });
        listen(audio, 'durationchange', () => {
          if (isFinite(audio.duration) && audio.duration > 0) set({ duration: audio.duration });
        });
        listen(audio, 'play', () => set({ playing: true, error: null }));
        listen(audio, 'pause', () => set({ playing: false }));
        listen(audio, 'playing', () => set({ playing: true, loading: false }));
        listen(audio, 'waiting', () => set({ loading: true }));
        listen(audio, 'canplay', () => set({ loading: false }));
        listen(audio, 'ended', () => advance(true));
        listen(audio, 'error', () => {
          if (!snap().track) return; // stop() clears src; ignore that teardown
          set({ playing: false, loading: false, error: t('audioError') });
        });
      }

      try {
        if (typeof navigator !== 'undefined' && 'mediaSession' in navigator) {
          const ms = navigator.mediaSession;
          const handlers = {
            play: () => toggle(),
            pause: () => { if (audio) audio.pause(); },
            previoustrack: () => prev(),
            nexttrack: () => advance(false),
            seekto: (d) => { if (d && typeof d.seekTime === 'number') seek(d.seekTime); },
          };
          for (const [name, fn] of Object.entries(handlers)) {
            try { ms.setActionHandler(name, fn); } catch { /* action unsupported */ }
            cleanups.push(() => { try { ms.setActionHandler(name, null); } catch { /* ignore */ } });
          }
        }
      } catch { /* MediaSession unavailable */ }

      function dispose() {
        for (const fn of cleanups.splice(0)) { try { fn(); } catch { /* ignore */ } }
        if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
      }

      return {
        source: store,
        playTracks,
        playAll: (tracks, opts) => playTracks(tracks, 0, opts),
        jumpTo,
        toggle,
        next: () => advance(false),
        prev,
        seek,
        setVolume,
        toggleMute,
        setMode,
        cycleMode,
        stop,
        dispose,
      };
    }

    /* ================================================================
     * 8. Shared UI atoms
     * ================================================================ */
    function IconButton({ label, onClick, active, disabled, className, children }) {
      return h('button', {
        type: 'button',
        className: cx('dshm-iconbtn', active && 'dshm-iconbtn-active', className),
        'aria-label': label, title: label, onClick, disabled,
        'aria-pressed': active === undefined ? undefined : !!active,
      }, children);
    }

    function Cover({ track, size, className }) {
      const [failed, setFailed] = useState(false);
      const id = track && track.id;
      useEffect(() => { setFailed(false); }, [id]);
      const url = track && track.coverUrl && !failed ? resolveUrl(track.coverUrl) : null;
      // With `size`, dimensions are inline; without it, a CSS class owns them
      // (the now-playing hero shrinks through a container query).
      const style = size ? { width: size, height: size } : undefined;
      const glyph = size ? Math.max(14, Math.round(size * 0.4)) : 64;
      return h('div', { className: cx('dshm-cover', className), style },
        url
          ? h('img', { src: url, alt: '', loading: 'lazy', draggable: false, onError: () => setFailed(true) })
          : h('span', { className: 'dshm-cover-fallback' }, h(IconNote, { size: glyph })));
    }

    function EqBars({ playing }) {
      return h('span', { className: cx('dshm-eq', playing && 'dshm-eq-on'), 'aria-hidden': true },
        h('i'), h('i'), h('i'));
    }

    /** One-cycle play-mode button meta: icon/label/hint for the current mode. */
    function modeMeta(t, shuffle, repeat) {
      if (shuffle) return { icon: IconShuffle, label: t('modeShuffle'), hint: t('modeHintShuffle') };
      if (repeat === 'one') return { icon: IconRepeatOne, label: t('modeOne'), hint: t('modeHintOne') };
      return { icon: IconRepeat, label: t('modeOrder'), hint: t('modeHintOrder') };
    }

    /** Token-styled slider with pointer + keyboard control, value 0..1. */
    /* ------------------------------------------------------------------
     * Welcome (v7): the blue big-fish-with-headphones mascot.
     * Drawn as inline SVG; every colour comes from theme tokens so the
     * illustration follows light/dark like the rest of the panel.
     * ------------------------------------------------------------------ */
    function FishLogo({ size }) {
      return h('svg', {
        viewBox: '0 0 200 200', width: size || 168, height: size || 168,
        className: 'dshm-fish', 'aria-hidden': 'true', focusable: 'false',
      },
        h('defs', null,
          h('linearGradient', { id: 'dshmFishBody', x1: '0.1', y1: '0', x2: '0.9', y2: '1' },
            h('stop', { offset: '0%', style: { stopColor: 'var(--dsw-alias-brand-primary)' } }),
            h('stop', { offset: '100%', style: { stopColor: 'var(--dsw-alias-brand-primary)', stopOpacity: '0.72' } }))),
        /* tail fin */
        h('path', {
          d: 'M44 104 C24 88 18 72 24 60 C42 72 52 83 60 96 L60 112 C52 125 42 136 24 148 C18 136 24 120 44 104 Z',
          fill: 'url(#dshmFishBody)',
        }),
        /* dorsal fin */
        h('path', {
          d: 'M92 58 C100 40 122 36 134 50 C126 60 110 66 98 68 Z',
          fill: 'url(#dshmFishBody)', opacity: '0.9',
        }),
        /* body */
        h('ellipse', { cx: 104, cy: 104, rx: 60, ry: 46, fill: 'url(#dshmFishBody)' }),
        /* belly highlight */
        h('ellipse', { cx: 110, cy: 122, rx: 38, ry: 20, fill: 'var(--dsw-alias-label-primary-inverted)', opacity: '0.18' }),
        /* headphone band */
        h('path', {
          d: 'M62 92 C62 44 144 44 144 92', fill: 'none',
          stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 9, strokeLinecap: 'round',
        }),
        /* ear cups */
        h('rect', { x: 52, y: 84, width: 22, height: 38, rx: 10, fill: 'var(--dsw-alias-label-primary)' }),
        h('rect', { x: 132, y: 84, width: 22, height: 38, rx: 10, fill: 'var(--dsw-alias-label-primary)' }),
        h('rect', { x: 58, y: 91, width: 10, height: 24, rx: 5, fill: 'var(--dsw-alias-bg-layer-1)', opacity: '0.35' }),
        h('rect', { x: 138, y: 91, width: 10, height: 24, rx: 5, fill: 'var(--dsw-alias-bg-layer-1)', opacity: '0.35' }),
        /* eye + pupil */
        h('circle', { cx: 140, cy: 104, r: 10, fill: 'var(--dsw-alias-label-primary-inverted)' }),
        h('circle', { cx: 143, cy: 104, r: 4.6, fill: 'var(--dsw-alias-label-primary)' }),
        /* mouth */
        h('path', {
          d: 'M148 122 q9 7 17 1', fill: 'none',
          stroke: 'var(--dsw-alias-label-primary)', strokeWidth: 3, strokeLinecap: 'round', opacity: '0.7',
        }),
        /* musical note */
        h('g', { transform: 'translate(158 52) rotate(12)', fill: 'var(--dsw-alias-label-primary)', opacity: '0.85' },
          h('rect', { x: 2, y: 0, width: 3, height: 22, rx: 1.5 }),
          h('path', { d: 'M5 0 q9 3 9 10 q-4 -4 -9 -3 Z' }),
          h('circle', { cx: 1, cy: 23, r: 4.4 })));
    }

    /* First-run welcome flow: hero -> taste -> library choice -> starter progress.
     * The host owns starter provisioning; this view only reflects its status. */
    function WelcomeView({ t, onboarding, useOnboarding, preview, onExitPreview, onRoute }) {
      const snap = useOnboarding((st) => st);
      const [step, setStep] = useState(0);
      const [genres, setGenres] = useState([]);
      const [langs, setLangs] = useState([]);
      const [mode, setMode] = useState('starter');
      const [dirPath, setDirPath] = useState('');
      const [busy, setBusy] = useState(false);
      const [failed, setFailed] = useState(false);

      const genreOptions = ['jazz', 'classical', 'electronic', 'blues', 'reggae', 'soul', 'folk', 'metal', 'funk', 'ambient'];
      const langOptions = [
        { value: '中文', key: 'lang_zh' }, { value: '英语', key: 'lang_en' }, { value: '粤语', key: 'lang_yue' },
        { value: '日语', key: 'lang_ja' }, { value: '韩语', key: 'lang_ko' }, { value: '法语', key: 'lang_fr' },
        { value: '西班牙语', key: 'lang_es' }, { value: '葡萄牙语', key: 'lang_pt' }, { value: '意大利语', key: 'lang_it' },
      ];
      const toggle = (list, setList, value) =>
        setList(list.indexOf(value) >= 0 ? list.filter((x) => x !== value) : list.concat([value]));

      const starter = snap.starter;
      const starterTracks = (starter && starter.tracks) || [];
      const starterTotal = (starter && starter.total) || starterTracks.length;
      const starterDone = (starter && starter.done) || 0;
      const starterStatus = starter ? starter.status : 'idle';
      const starterPct = starterTotal > 0 ? Math.min(100, Math.round((starterDone / starterTotal) * 100)) : (starterStatus === 'ready' ? 100 : 0);

      async function finish() {
        /* Preview mode must never touch real state: no POST, no prefs, no route. */
        if (preview) { onExitPreview(); return; }
        if (busy) return;
        setBusy(true);
        setFailed(false);
        try {
          const payload = { taste: { genres, languages: langs }, libraryMode: mode };
          if (mode === 'starter') payload.useStarter = true;
          else if (dirPath.trim()) payload.libraryPath = dirPath.trim();
          await onboarding.complete(payload);
        } catch (err) {
          setFailed(true);
          setBusy(false);
          return;
        }
        setBusy(false);
        if (mode === 'starter') setStep(3);
        else onRoute('library');
      }

      function skipAll() {
        if (preview) { onExitPreview(); return; }
        onRoute('reco');
      }

      const tasteChip = (value, label, list, setList) => h('button', {
        key: value, type: 'button',
        className: cx('dshm-wchip', list.indexOf(value) >= 0 && 'dshm-wchip-on'),
        'aria-pressed': list.indexOf(value) >= 0,
        onClick: () => toggle(list, setList, value),
      }, label);

      const dots = h('div', { className: 'dshm-wdots', 'aria-hidden': true },
        [0, 1, 2, 3].map((i) => h('span', { key: i, className: cx('dshm-wdot', i === step && 'dshm-wdot-on') })));

      const hero = h('div', { className: 'dshm-welcome-hero' },
        h('div', { className: 'dshm-welcome-glow', 'aria-hidden': true }),
        h('div', { className: 'dshm-welcome-fish' }, h(FishLogo, { size: 176 })),
        h('h1', { className: 'dshm-welcome-title' }, t('welcomeTitle')),
        h('p', { className: 'dshm-welcome-sub' }, t('welcomeSub')),
        h('div', { className: 'dshm-welcome-actions' },
          h('button', {
            type: 'button', className: 'dshm-wbtn dshm-wbtn-primary',
            onClick: () => setStep(1),
          }, h(IconSparkles, { size: 16 }), t('welcomeStart')),
          preview
            ? h('button', { type: 'button', className: 'dshm-wbtn', onClick: onExitPreview }, t('welcomeBack'))
            : h('button', { type: 'button', className: 'dshm-wbtn', onClick: skipAll }, t('welcomeSkip'))),
        h('div', { className: 'dshm-welcome-points' },
          [t('welcomePoint1'), t('welcomePoint2'), t('welcomePoint3')]
            .map((text, i) => h('div', { className: 'dshm-wpoint', key: i }, h(IconCheck, { size: 13 }), h('span', null, text)))));

      const taste = h('div', { className: 'dshm-welcome-panel' },
        h('h2', { className: 'dshm-wstep-title' }, t('welcomeTasteTitle')),
        h('p', { className: 'dshm-wstep-sub' }, t('welcomeTasteSub')),
        h('div', { className: 'dshm-wgroup' },
          h('div', { className: 'dshm-wlabel' }, t('welcomeGenres')),
          h('div', { className: 'dshm-wchips' }, genreOptions.map((g) => tasteChip(g, t('genre_' + g), genres, setGenres)))),
        h('div', { className: 'dshm-wgroup' },
          h('div', { className: 'dshm-wlabel' }, t('welcomeLanguages')),
          h('div', { className: 'dshm-wchips' }, langOptions.map((o) => tasteChip(o.value, t(o.key), langs, setLangs)))),
        h('p', { className: 'dshm-whint' }, t('welcomeTasteNote')),
        h('div', { className: 'dshm-welcome-actions' },
          h('button', { type: 'button', className: 'dshm-wbtn', onClick: () => setStep(0) }, t('welcomePrev')),
          h('button', { type: 'button', className: 'dshm-wbtn dshm-wbtn-primary', onClick: () => setStep(2) }, t('welcomeNext'))));

      const pickCard = (value, icon, title, body) => h('button', {
        key: value, type: 'button',
        className: cx('dshm-wcard', mode === value && 'dshm-wcard-on'),
        'aria-pressed': mode === value,
        onClick: () => setMode(value),
      },
        h('span', { className: 'dshm-wcard-icon' }, h(icon, { size: 20 })),
        h('span', { className: 'dshm-wcard-text' },
          h('span', { className: 'dshm-wcard-title' }, title),
          h('span', { className: 'dshm-wcard-body' }, body)));

      const library = h('div', { className: 'dshm-welcome-panel' },
        h('h2', { className: 'dshm-wstep-title' }, t('welcomeLibTitle')),
        h('p', { className: 'dshm-wstep-sub' }, t('welcomeLibSub')),
        h('div', { className: 'dshm-wcards' },
          pickCard('local', IconFolder, t('welcomeLocalTitle'), t('welcomeLocalBody')),
          pickCard('starter', IconSparkles, t('welcomeStarterTitle'), t('welcomeStarterBody'))),
        mode === 'starter'
          ? h('p', { className: 'dshm-whint' }, t('welcomeStarterHint'))
          : h('div', { className: 'dshm-wpath' },
              h('label', { className: 'dshm-wlabel', htmlFor: 'dshm-wpath' }, t('welcomePathLabel')),
              h('input', {
                id: 'dshm-wpath', type: 'text', className: 'dshm-winput',
                placeholder: t('welcomePathPlaceholder'), value: dirPath,
                onChange: (e) => setDirPath(e.target.value),
              }),
              h('p', { className: 'dshm-whint' }, t('welcomePathHint'))),
        failed ? h('p', { className: 'dshm-whint dshm-whint-err' }, t('welcomeSaveFail')) : null,
        h('div', { className: 'dshm-welcome-actions' },
          h('button', { type: 'button', className: 'dshm-wbtn', onClick: () => setStep(1) }, t('welcomePrev')),
          h('button', {
            type: 'button', className: 'dshm-wbtn dshm-wbtn-primary', disabled: busy,
            onClick: finish,
          }, h(IconCheck, { size: 15 }), t('welcomeFinish'))));

      const starterPanel = h('div', { className: 'dshm-welcome-panel' },
        h('h2', { className: 'dshm-wstep-title' }, t('welcomeStarterTitle')),
        h('p', { className: 'dshm-wstep-sub' },
          starterStatus === 'ready' ? t('welcomeStarterReady')
            : starterStatus === 'failed' || starterStatus === 'skipped' ? t('welcomeStarterSkipped')
              : t('welcomeStarterDownloading')),
        h('div', { className: 'dshm-wprogress' },
          h('div', { className: 'dshm-wprogress-track' },
            h('div', { className: 'dshm-wprogress-fill', style: { width: starterPct + '%' } })),
          h('span', { className: 'dshm-count' }, starterDone + ' / ' + starterTotal)),
        starterTracks.length
          ? h('div', { className: 'dshm-wtracks' },
              h('div', { className: 'dshm-wlabel' }, t('welcomeCredits')),
              starterTracks.slice(0, 6).map((tr, i) => h('div', { className: 'dshm-wtrack', key: i },
                h('span', { className: 'dshm-ellipsis' }, (tr.title || '') + (tr.artist ? ' · ' + tr.artist : '')),
                h('span', { className: 'dshm-wtrack-lic' }, tr.license || tr.source || ''))))
          : null,
        h('div', { className: 'dshm-welcome-actions' },
          h('button', {
            type: 'button', className: 'dshm-wbtn dshm-wbtn-primary',
            onClick: () => (preview ? onExitPreview() : onRoute('reco')),
          }, h(IconSparkles, { size: 15 }), t('welcomeEnter'))));

      const panels = [hero, taste, library, starterPanel];
      return h('div', { className: cx('dshm-welcome', preview && 'dshm-welcome-preview') },
        h('div', { className: 'dshm-welcome-inner' },
          panels[step] || hero,
          step > 0 && step < 3 ? dots : null,
          preview
            ? h('button', { type: 'button', className: 'dshm-wclose', title: t('welcomeBack'), onClick: onExitPreview }, h(IconClose, { size: 14 }))
            : null));
    }

    function Slider({ value, onChange, label, disabled, className }) {
      const ref = useRef(null);
      const [drag, setDrag] = useState(null);
      const v = Math.min(1, Math.max(0, drag == null ? (value || 0) : drag));
      const fromEvent = (e) => {
        const el = ref.current;
        if (!el) return 0;
        const r = el.getBoundingClientRect();
        return r.width > 0 ? Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) : 0;
      };
      return h('div', {
        ref,
        className: cx('dshm-slider', drag != null && 'dshm-slider-drag', disabled && 'dshm-slider-disabled', className),
        role: 'slider', tabIndex: disabled ? -1 : 0,
        'aria-label': label, 'aria-valuemin': 0, 'aria-valuemax': 100,
        'aria-valuenow': Math.round(v * 100), 'aria-disabled': disabled || undefined,
        onPointerDown: (e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const f = fromEvent(e); setDrag(f); onChange(f);
        },
        onPointerMove: (e) => {
          if (disabled || drag == null) return;
          const f = fromEvent(e); setDrag(f); onChange(f);
        },
        onPointerUp: () => { if (drag != null) setDrag(null); },
        onPointerCancel: () => { if (drag != null) setDrag(null); },
        onKeyDown: (e) => {
          if (disabled) return;
          const step = 0.05;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { onChange(Math.min(1, (value || 0) + step)); e.preventDefault(); }
          else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { onChange(Math.max(0, (value || 0) - step)); e.preventDefault(); }
          else if (e.key === 'Home') { onChange(0); e.preventDefault(); }
          else if (e.key === 'End') { onChange(1); e.preventDefault(); }
        },
      }, h('div', { className: 'dshm-slider-track' },
        h('div', { className: 'dshm-slider-fill', style: { width: (v * 100) + '%' } }),
        h('div', { className: 'dshm-slider-thumb', style: { left: (v * 100) + '%' } })));
    }

    function EmptyState({ icon, title, body, tone, children }) {
      return h('div', { className: 'dshm-state' },
        h('div', { className: cx('dshm-state-icon', tone === 'error' && 'dshm-state-error') }, icon),
        h('div', { className: cx('dshm-state-title', tone === 'error' && 'dshm-state-error') }, title),
        body ? h('div', { className: 'dshm-state-body' }, body) : null,
        children);
    }

    function SkeletonRows() {
      const rows = [];
      for (let i = 0; i < 9; i++) {
        rows.push(h('div', { key: i, className: 'dshm-skel-row' },
          h('div', { className: 'dshm-skel-box', style: { width: 40, height: 40 } }),
          h('div', { style: { flex: 1, display: 'flex', flexDirection: 'column', gap: 6 } },
            h('div', { className: 'dshm-skel-box', style: { height: 12, width: (38 + ((i * 17) % 40)) + '%' } }),
            h('div', { className: 'dshm-skel-box', style: { height: 9, width: (22 + ((i * 11) % 26)) + '%' } }))));
      }
      return h('div', { className: 'dshm-skel', 'aria-hidden': true }, rows);
    }

    function sourceLabel(source, t) {
      if (source === 'spotify-liked') return t('sourceSpotify');
      if (source === 'dsh-music') return t('sourceDsh');
      if (source === 'apple-music') return t('sourceApple');
      return source || '';
    }

    function LikeButton({ t, item, likes, useLikes }) {
      const liked = useLikes((st) => !!st.keys[likeKey(item)]);
      return h('button', {
        type: 'button',
        className: cx('dshm-like-btn', liked && 'dshm-like-btn-on'),
        'aria-label': liked ? t('unlikeBtn') : t('likeBtn'),
        'aria-pressed': !!liked,
        title: liked ? t('likedBtn') : t('likeBtn'),
        onClick: (e) => { e.stopPropagation(); likes.toggle(item, !liked); },
      }, h(IconHeart, { size: 15, style: liked ? { fill: 'currentColor' } : undefined }));
    }

    function TrackRow({ track, index, isCurrent, playing, onPlay, onDelete, onReveal, onOpenArtist, likes, useLikes, t }) {
      return h('div', {
        className: cx('dshm-row', isCurrent && 'dshm-row-current'),
        role: 'button', tabIndex: 0,
        'aria-label': t('playTrack') + ': ' + track.title,
        onClick: () => onPlay(track, index),
        onKeyDown: (e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(track, index); }
        },
      },
        h(Cover, { track, size: 40 }),
        h('div', { className: 'dshm-row-info' },
          h('div', { className: 'dshm-row-title' },
            isCurrent ? h(EqBars, { playing }) : null,
            h('span', { className: 'dshm-ellipsis' }, track.title || t('untitled'))),
          h('div', { className: 'dshm-row-sub dshm-ellipsis' },
            onOpenArtist && track.artist
              ? h('button', {
                  type: 'button', className: 'dshm-row-sub-btn',
                  title: t('artistOpen'), 'aria-label': t('artistOpen'),
                  onClick: (e) => { e.stopPropagation(); onOpenArtist(track.artist); },
                }, track.artist)
              : (track.artist || t('unknownArtist')),
            track.album ? ' · ' + track.album : '')),
        h('span', { className: 'dshm-row-dur' }, formatTime(track.duration)),
        likes ? h(LikeButton, { t, item: track, likes, useLikes }) : null,
        onDelete ? h('span', { className: 'dshm-row-actions', onClick: (e) => e.stopPropagation() },
          h(IconButton, { label: t('revealTrack'), onClick: (e) => { e.stopPropagation(); onReveal(track); } }, h(IconDisc, { size: 14 })),
          h(IconButton, { label: t('deleteTrack'), onClick: (e) => { e.stopPropagation(); onDelete(track); } }, h(IconClose, { size: 14 }))) : null,
        h('span', { className: 'dshm-row-play', 'aria-hidden': true }, h(IconPlay, { size: 15 })));
    }

    /* ================================================================
     * 9. Library view — search, grouping, play-all / shuffle
     * ================================================================ */
    function LibraryView({ t, player, library, sync, download, preview, likes, openArtistPage, artistImages, useSync, useDownload, useLibrary, usePlayer, useLikes, useArtistImages }) {
      const status = useLibrary((s) => s.status);
      const tracks = useLibrary((s) => s.tracks);
      const error = useLibrary((s) => s.error);
      const currentId = usePlayer((s) => (s.track ? s.track.id : null));
      const playing = usePlayer((s) => s.playing);
      const [query, setQuery] = useState('');
      const [searchState, setSearchState] = useState({ status: 'idle', local: [], remote: [] });
      const [groupBy, setGroupBy] = useState('none');
      const [rowError, setRowError] = useState('');
      const [playNotice, setPlayNotice] = useState('');
      const searchRef = useRef(null);
      const shuffle = usePlayer((s) => s.shuffle);
      const repeat = usePlayer((s) => s.repeat);
      const mode = modeMeta(t, shuffle, repeat);
      const syncAvail = useSync ? useSync((st) => st.available) : null;
      const syncHint = useSync ? useSync((st) => st.hint) : null;
      const syncUsable = syncAvail !== false;
      const syncState = useSync ? useSync((st) => st.phase) : 'idle';

      /* Backend search (local filter + MusicBrainz completion), debounced.
       * Empty query keeps the pure client-side browse below. */
      useEffect(() => {
        const q = query.trim();
        if (!q) { setSearchState({ status: 'idle', local: [], remote: [] }); return; }
        setSearchState((s0) => ({ ...s0, status: 'loading' }));
        const timer = setTimeout(() => {
          let dead = false;
          library.searchRemote
            ? library.searchRemote(q)
              .then((data) => { if (!dead) setSearchState({ status: 'ready', local: (data && data.local) || [], remote: (data && data.remote) || [] }); })
              .catch((err) => { if (!dead) setSearchState({ status: 'error', local: [], remote: [], error: (err && err.message) || String(err) }); })
            : null;
          return () => { dead = true; };
        }, 350);
        return () => clearTimeout(timer);
      }, [query]);

      /* Remote match = preview (temporary cache, never added to the library);
       * only ♥ puts a song into the library. Same flow as recommendations. */
      function playRemote(item) {
        setPlayNotice('');
        playSong(item, player, tracks, preview, setPlayNotice, t);
      }

      const filtered = useMemo(() => {
        const q = normalizeZh(query.trim());
        if (!q) return tracks;
        return tracks.filter((tr) =>
          normalizeZh(tr.title).includes(q) ||
          normalizeZh(tr.artist).includes(q) ||
          normalizeZh(tr.album).includes(q));
      }, [tracks, query]);
      /* While the backend search is ready, its local list wins (it shares the
       * same normalization); otherwise fall back to instant client filtering. */
      const searching = !!query.trim();
      const shownList = searching && searchState.status === 'ready' ? searchState.local : filtered;

      const groups = useMemo(() => {
        if (groupBy === 'none' || searching) return null;
        const map = new Map();
        for (const tr of shownList) {
          const key = (groupBy === 'artist' ? tr.artist : tr.album) || (groupBy === 'artist' ? t('unknownArtist') : t('unknownAlbum'));
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(tr);
        }
        return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], 'zh'));
      }, [shownList, groupBy, searching, t]);

      // The queue is always the flat shown list, so grouped rows map back
      // to their flat index and next/prev keep walking the visible results.
      const playFromFiltered = useCallback((track) => {
        const index = shownList.indexOf(track);
        player.playTracks(shownList, index >= 0 ? index : 0);
      }, [shownList, player]);

      async function onDelete(track) {
        const liked = track.source === 'spotify-liked';
        if (liked) {
          if (!window.confirm(t('deleteLikedConfirm'))) return;
          if (!window.confirm(t('deleteLikedConfirm2'))) return;
        } else if (!window.confirm(t('deleteConfirm'))) return;
        try {
          setRowError('');
          await library.remove(track.id, true);
        } catch (err) {
          setRowError((err && err.message) || t('deleteFailed'));
        }
      }
      async function onReveal(track) {
        try { setRowError(''); await library.reveal(track.id); }
        catch (err) { setRowError((err && err.message) || t('deleteFailed')); }
      }
      const renderRow = (tr, i) => h(TrackRow, {
        key: tr.id || i, track: tr, index: i,
        isCurrent: currentId === tr.id, playing,
        onPlay: playFromFiltered, onDelete, onReveal, onOpenArtist: openArtistPage, likes, useLikes, t,
      });

      function RemoteRow(item, i) {
        const isArtist = item.kind === 'artist';
        const name = isArtist ? (item.name || item.artist || '') : (item.title || '');
        const sub = isArtist
          ? t('searchTypeArtist')
          : (item.artist || '') + (item.album ? ' · ' + item.album : '');
        return h('div', { className: 'dshm-row', key: 'r' + i, role: 'listitem' },
          isArtist
            ? h(ArtistAvatar, { name, size: 40, service: artistImages, useArtistImages })
            : h('div', { className: 'dshm-tile', style: { width: 40, height: 40 } }, h(IconNote, { size: 15 })),
          h('div', { className: 'dshm-row-info' },
            h('div', { className: 'dshm-row-title' },
              isArtist ? h('span', { className: 'dshm-cat-chip' }, t('searchTypeArtist')) : null,
              h('span', { className: 'dshm-ellipsis' }, name)),
            h('div', { className: 'dshm-row-sub dshm-ellipsis' },
              isArtist || !item.artist
                ? sub
                : h(React.Fragment, null,
                    h('button', {
                      type: 'button', className: 'dshm-row-sub-btn',
                      title: t('artistOpen'), 'aria-label': t('artistOpen'),
                      onClick: () => openArtistPage(item.artist),
                    }, item.artist),
                    item.album ? ' · ' + item.album : ''))),
          isArtist
            ? h('button', {
                type: 'button', className: 'dshm-chipbtn',
                onClick: () => openArtistPage(name),
              }, h(IconNote, { size: 13 }), t('artistOpen'))
            : h('button', {
                type: 'button', className: 'dshm-chipbtn',
                onClick: () => playRemote(item),
                title: t('previewLabel'),
              }, h(IconPlay, { size: 13 }), t('previewLabel')));
      }

      let content;
      const remoteList = searching && searchState.status === 'ready' ? searchState.remote : [];
      if (status === 'loading' && tracks.length === 0) {
        content = h('div', { className: 'dshm-list' }, h(SkeletonRows));
      } else if (status === 'error' && tracks.length === 0) {
        content = h(EmptyState, {
          icon: h(IconAlert, { size: 30 }), tone: 'error',
          title: t('loadError'),
          body: (error || '') + ' ' + t('scanFailedHint'),
        }, h('button', { type: 'button', className: 'dshm-chipbtn', onClick: () => library.load() }, t('retry')));
      } else if (status === 'ready' && tracks.length === 0) {
        content = h(EmptyState, {
          icon: h(IconNote, { size: 30 }),
          title: t('emptyLibraryTitle'), body: t('emptyLibraryBody'),
        },
          h('div', { className: 'dshm-empty-ctas' },
            h('button', {
              type: 'button', className: 'dshm-chipbtn dshm-chipbtn-primary',
              onClick: () => { if (searchRef.current) searchRef.current.focus(); },
            }, h(IconSearch, { size: 14 }), t('emptySearchCta')),
            h('button', {
              type: 'button', className: 'dshm-chipbtn',
              onClick: () => library.rescan(),
            }, h(IconRefresh, { size: 14 }), t('emptyRescanCta')),
            sync ? h('button', {
              type: 'button',
              className: cx('dshm-chipbtn', !syncUsable && 'dshm-chipbtn-off'),
              disabled: !syncUsable || syncState === 'running',
              title: syncUsable ? (syncHint || t('syncOptionalHint')) : (syncHint || t('syncUnavailableHint')),
              onClick: () => sync.start(),
            }, h(IconRefresh, { size: 14, className: syncState === 'running' ? 'dshm-spin' : undefined }), t('syncOptional')) : null),
          h('div', { className: 'dshm-empty-dirs' },
            h('div', { className: 'dshm-empty-dirs-head' }, t('emptyAddDirHint')),
            ['~/Music/dsh-music', '~/Music/spotify-liked', '~/Music/Music/Media.localized']
              .map((d) => h('code', { key: d, className: 'dshm-empty-dir' }, d)),
            h('div', { className: 'dshm-count' }, t('emptyDirNote'))));
      } else if (searching && searchState.status === 'loading') {
        content = h('div', { className: 'dshm-list' }, h(SkeletonRows));
      } else if (shownList.length === 0 && remoteList.length === 0) {
        content = h(EmptyState, {
          icon: h(IconSearch, { size: 28 }),
          title: query.trim() ? '“' + query.trim() + '”' : t('searchEmpty'),
          body: query.trim() ? t('searchNoLocal') : t('searchEmpty'),
        });
      } else {
        content = h('div', { className: 'dshm-list' },
          groups ? groups.map(([name, list]) =>
            h('section', { key: name },
              h('div', { className: 'dshm-group-head' },
                groupBy === 'artist' && name !== t('unknownArtist')
                  ? h(ArtistAvatar, { name, size: 20, service: artistImages, useArtistImages })
                  : h(groupBy === 'artist' ? IconNote : IconDisc, { size: 14 }),
                h('span', { className: 'dshm-ellipsis' }, name),
                h('span', { className: 'dshm-group-count' }, list.length + ' ' + t('tracksUnit'))),
              list.map((tr, i) => renderRow(tr, i))))
            : shownList.map((tr, i) => renderRow(tr, i)),
          remoteList.length > 0
            ? h('section', null,
                h('div', { className: 'dshm-group-head' },
                  h(IconSearch, { size: 14 }),
                  h('span', { className: 'dshm-ellipsis' }, t('searchWebTitle')),
                  h('span', { className: 'dshm-group-count' }, remoteList.length + ' ' + t('tracksUnit'))),
                remoteList.map((item, i) => RemoteRow(item, i)))
            : null,
          shownList.length === 0 && remoteList.length > 0 && searching
            ? h('div', { className: 'dshm-lyrics-hint', style: { padding: '4px 8px' } }, t('searchNoLocal'))
            : null);
      }

      const busy = status === 'loading';
      return h(React.Fragment, null,
        sync ? h(SyncPanel, { t, sync, useSync }) : null,
        rowError ? h('div', { className: 'dshm-errorline', role: 'alert', style: { margin: '8px 24px 0' } }, rowError) : null,
        h('div', { className: 'dshm-toolbar' },
          h('label', { className: 'dshm-search' },
            h(IconSearch, { size: 15 }),
            h('input', {
              type: 'search', value: query, placeholder: t('searchPlaceholder'), ref: searchRef,
              'aria-label': t('searchPlaceholder'),
              onChange: (e) => setQuery(e.target.value),
            })),
          h('select', {
            className: 'dshm-select', value: groupBy, 'aria-label': t('groupLabel'),
            onChange: (e) => setGroupBy(e.target.value),
          },
            h('option', { value: 'none' }, t('groupNone')),
            h('option', { value: 'artist' }, t('groupArtist')),
            h('option', { value: 'album' }, t('groupAlbum'))),
          h('button', {
            type: 'button', className: 'dshm-chipbtn dshm-chipbtn-primary',
            disabled: busy || shownList.length === 0,
            onClick: () => player.playAll(shownList),
          }, h(IconPlay, { size: 13 }), t('playAll')),
          h('button', {
            type: 'button', className: cx('dshm-chipbtn', 'dshm-mode-cycle'),
            'aria-label': mode.label, title: mode.hint + ' · ' + t('modeCycleHint'),
            onClick: () => player.cycleMode(),
          }, h(mode.icon, { size: 14 })),
          sync ? h('button', {
            type: 'button', className: cx('dshm-chipbtn', !syncUsable && 'dshm-chipbtn-off'),
            disabled: syncState === 'running' || busy || !syncUsable,
            title: syncUsable ? (syncHint || t('syncOptionalHint')) : (syncHint || t('syncUnavailableHint')),
            onClick: () => sync.start(),
          }, h(IconRefresh, { size: 13, className: syncState === 'running' ? 'dshm-spin' : undefined }),
            syncState === 'running' ? t('syncing') : t('syncBtn')) : null,
          h('span', { className: 'dshm-count', style: { marginLeft: 'auto' } },
            busy && tracks.length === 0 ? t('rescanning') : shownList.length + ' ' + t('tracksUnit'))),
        playNotice
          ? h('div', { className: 'dshm-mode-hint', style: { margin: '0 20px 6px', textAlign: 'right' }, role: 'status' }, playNotice)
          : null,
        content);
    }

    /* ================================================================
     * 10. Now-playing view — hero + transport + queue
     * ================================================================ */
    function NowPlayingView({ t, player, lyrics, usePlayer, useLyrics, openView, openArtistPage, artistImages, useArtistImages }) {
      const track = usePlayer((s) => s.track);
      const playing = usePlayer((s) => s.playing);
      const position = usePlayer((s) => s.position);
      const duration = usePlayer((s) => s.duration);
      const volume = usePlayer((s) => s.volume);
      const muted = usePlayer((s) => s.muted);
      const shuffle = usePlayer((s) => s.shuffle);
      const repeat = usePlayer((s) => s.repeat);
      const mode = modeMeta(t, shuffle, repeat);
      const error = usePlayer((s) => s.error);
      const queue = usePlayer((s) => s.queue);
      const queueIndex = usePlayer((s) => s.queueIndex);

      if (!track) {
        return h(EmptyState, {
          icon: h(IconDisc, { size: 30 }),
          title: t('noTrackTitle'), body: t('noTrackBody'),
        }, h('button', { type: 'button', className: 'dshm-chipbtn dshm-chipbtn-primary', onClick: () => openView('library') }, h(IconNote, { size: 14 }), t('goLibrary')));
      }

      const frac = duration > 0 ? position / duration : 0;
      const RepeatIcon = repeat === 'one' ? IconRepeatOne : IconRepeat;
      const repeatLabel = repeat === 'one' ? t('repeatOne') : repeat === 'all' ? t('repeatAll') : t('repeatOff');

      return h('div', { className: 'dshm-now' },
        h('div', { className: 'dshm-now-hero' },
          h(Cover, { track, className: 'dshm-now-cover' }),
          h('div', { className: 'dshm-now-meta' },
            h('span', { className: 'dshm-source-chip' }, h(IconDisc, { size: 12 }), sourceLabel(track.source, t)),
            h('h2', { className: 'dshm-now-title dshm-ellipsis' }, track.title),
            h('p', { className: 'dshm-now-sub dshm-ellipsis' },
              h('button', {
                type: 'button', className: 'dshm-artist-btn',
                title: t('artistOpen'), 'aria-label': t('artistOpen'),
                onClick: () => openArtistPage(track.artist || ''),
              },
                h(ArtistAvatar, { name: track.artist || '', size: 18, service: artistImages, useArtistImages }),
                h('span', null, track.artist || t('unknownArtist'))),
              track.album ? ' · ' + track.album : ''),
            error ? h('div', { className: 'dshm-errorline', role: 'alert' }, h(IconAlert, { size: 15 }), error) : null,
            h('div', { className: 'dshm-seekrow' },
              h('span', { className: 'dshm-time' }, formatTime(position)),
              h(Slider, {
                value: frac, label: t('seekLabel'), disabled: !(duration > 0),
                onChange: (f) => player.seek(f * duration),
              }),
              h('span', { className: 'dshm-time dshm-time-end' }, formatTime(duration))),
            h('div', { className: 'dshm-transport' },
              h(IconButton, {
                label: mode.label, title: mode.hint + ' · ' + t('modeCycleHint'),
                className: cx((shuffle || repeat === 'one') && 'dshm-iconbtn-active'),
                onClick: () => player.cycleMode(),
              }, h(mode.icon, { size: 17 })),
              h(IconButton, { label: t('prev'), onClick: () => player.prev() }, h(IconPrev, { size: 20 })),
              h('button', {
                type: 'button', className: 'dshm-playbtn',
                'aria-label': playing ? t('pause') : t('play'),
                onClick: () => player.toggle(),
              }, h(playing ? IconPause : IconPlay, { size: 22 })),
              h(IconButton, { label: t('next'), onClick: () => player.next() }, h(IconNext, { size: 20 }))),
            h('div', { className: 'dshm-volumerow' },
              h(IconButton, { label: muted ? t('unmute') : t('mute'), onClick: () => player.toggleMute() },
                h(muted || volume === 0 ? IconMute : IconVolume, { size: 17 })),
              h(Slider, { value: muted ? 0 : volume, label: t('volume'), onChange: (f) => player.setVolume(f) }),
              h('span', { className: 'dshm-volume-pct' }, Math.round((muted ? 0 : volume) * 100) + '%')))),
        h(LyricsPanel, { t, lyrics, useLyrics, usePlayer }),
        h('div', { className: 'dshm-queue' },
          h('div', { className: 'dshm-queue-head' },
            h(IconQueue, { size: 15 }), t('queue'),
            h('span', { className: 'dshm-count' }, queue.length + ' ' + t('tracksUnit'))),
          queue.length === 0
            ? h('div', { className: 'dshm-state-body', style: { padding: '12px 8px' } }, t('queueEmpty'))
            : queue.map((tr, i) => h(TrackRow, {
              key: (tr.id || '') + ':' + i, track: tr, index: i,
              isCurrent: i === queueIndex, playing: playing && i === queueIndex,
              onPlay: (_tr, idx) => player.jumpTo(idx), onOpenArtist: openArtistPage, t,
            }))));
    }

    /* ================================================================
     * 11. Recommendations view (S3 live): batch cards + download queue
     * ================================================================ */
    function DownloadPanel({ t, download, useDownload }) {
      const s = useDownload((st) => st);
      if (!s.running && s.items.length === 0 && !s.error) return null;
      const anyOk = s.items.some((it) => it.status === 'ok');
      return h('div', { className: 'dshm-dl' },
        h('div', { className: 'dshm-asec-title' },
          h(IconDownload, { size: 13 }), t('downloadTitle'),
          s.running ? h('span', { className: 'dshm-count' }, s.done + ' / ' + s.total) : null),
        s.total > 0 ? h('div', { className: 'dshm-dl-bar', 'aria-hidden': true },
          h('div', { style: { width: Math.round((s.done / s.total) * 100) + '%' } })) : null,
        s.error
          ? h('div', { className: 'dshm-errorline', role: 'alert' }, h(IconAlert, { size: 14 }), t('downloadError') + '：' + s.error)
          : null,
        s.items.map((it, i) => h('div', { className: 'dshm-dl-row', key: i },
          h('span', { className: cx('dshm-dl-dot', it.status === 'ok' && 'dshm-dl-ok', it.status === 'fail' && 'dshm-dl-fail') }),
          h('span', { className: 'dshm-ellipsis', style: { flex: 1 } },
            (it.artist || '') + ' - ' + (it.title || '')),
          h('span', { className: 'dshm-dl-status' },
            it.status === 'ok' ? t('downloadDone')
              : it.status === 'fail' ? t('downloadFail')
                : t('downloading')),
          it.status === 'fail' && it.note ? h('span', { className: 'dshm-sim-chip-reason' }, it.note) : null)),
        !s.running && anyOk ? h('div', { className: 'dshm-lyrics-hint' }, t('downloadPlay')) : null);
    }

    /* V3 helpers: shared play-or-preview flow (preview never enters the
     * library; only ♥-like downloads it — the Host handles that on like). */
    function playSong(item, player, tracks, preview, setNotice, t) {
      const local = (item.trackId && tracks.find((tr) => tr.id === item.trackId))
        || tracks.find((tr) =>
          normalizeZh(tr.artist) === normalizeZh(item.artist) &&
          normalizeZh(tr.title) === normalizeZh(item.title));
      if (local) {
        setNotice('');
        player.playTracks([local], 0);
        return;
      }
      if (!item.verification) { setNotice(t('previewNoVerify')); return; }
      setNotice(t('previewLoading'));
      preview.start(item, (res) => {
        if (res.error) { setNotice(t('previewFail') + '：' + res.error); return; }
        setNotice('');
        player.playTracks([{
          id: 'preview:' + likeKey(item),
          title: item.title, artist: item.artist, album: item.album,
          coverUrl: item.coverUrl || null, audioUrl: res.audioUrl, duration: null,
        }], 0);
      });
    }

    /* Image URL: external absolute URLs pass through; root-absolute Host paths
     * resolve against the document base. */
    function imgUrl(url) {
      return /^https?:\/\//i.test(String(url || '')) ? url : resolveUrl(url);
    }

    /* Square/round image with a graceful glyph fallback (no broken icons). */
    function Thumb({ src, size, round, glyph, style, className }) {
      const [failed, setFailed] = useState(false);
      const s = size || 38;
      const box = {
        width: s, height: s,
        borderRadius: round ? '50%' : 8,
        flex: 'none',
        ...style,
      };
      if (src && !failed) {
        return h('div', { className: cx('dshm-tile', className), style: box },
          h('img', {
            src: imgUrl(src), alt: '', loading: 'lazy', draggable: false,
            onError: () => setFailed(true),
          }));
      }
      return h('div', { className: cx('dshm-tile', className), style: box },
        h(glyph || IconNote, { size: Math.max(12, Math.round(s * 0.4)) }));
    }

    /* Small round artist portrait: one shared batch lookup with a glyph fallback. */
    function ArtistAvatar({ name, size, service, useArtistImages }) {
      const key = normalizeZh(name).trim();
      const url = useArtistImages((s) => (key ? s.images[key] : null));
      useEffect(() => { if (name) service.request(name); }, [name]);
      return h(Thumb, { src: url || null, size: size || 20, round: true, glyph: IconNote });
    }

    function SongRow({ t, item, likes, useLikes, onPlay, onOpenArtist, isCurrent, playing, showReason }) {
      const liked = useLikes((st) => !!st.keys[likeKey(item)]);
      return h('div', { className: cx('dshm-srow', isCurrent && 'dshm-row-current') },
        h(Thumb, { src: item.coverUrl, size: 38 }),
        h('div', {
          className: 'dshm-srow-main', role: 'button', tabIndex: 0,
          'aria-label': t('playTrack') + ': ' + (item.title || ''),
          onClick: () => onPlay(item),
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPlay(item); } },
        },
          h('span', { className: 'dshm-srow-title dshm-ellipsis' }, item.title || t('untitled')),
          h('span', { className: 'dshm-srow-sub dshm-ellipsis' },
            onOpenArtist && item.artist
              ? h('button', {
                  type: 'button', className: 'dshm-srow-artist',
                  title: t('artistOpen'), 'aria-label': t('artistOpen'),
                  onClick: (e) => { e.stopPropagation(); onOpenArtist(item.artist); },
                }, item.artist)
              : (item.artist || t('unknownArtist')),
            item.album ? ' · ' + item.album : ''),
          showReason && item.reason ? h('span', { className: 'dshm-srow-reason' }, item.reason) : null),
        h('button', {
          type: 'button',
          className: cx('dshm-like-btn', liked && 'dshm-like-btn-on'),
          'aria-label': liked ? t('unlikeBtn') : t('likeBtn'),
          'aria-pressed': !!liked,
          title: liked ? t('likedBtn') : t('likeBtn'),
          onClick: () => likes.toggle(item, !liked),
        }, h(IconHeart, { size: 15, style: liked ? { fill: 'currentColor' } : undefined })),
        h('button', {
          type: 'button', className: 'dshm-playround',
          'aria-label': isCurrent && playing ? t('pause') : t('play'),
          title: isCurrent && playing ? t('pause') : t('previewLabel'),
          onClick: () => onPlay(item),
        }, h(isCurrent && playing ? IconPause : IconPlay, { size: 13 })));
    }

    /* Artist column row: real artist/band image + name + genre hint + chevron. */
    function ArtistTile({ t, a, onOpen }) {
      return h('button', {
        type: 'button', className: 'dshm-arow',
        onClick: () => onOpen(a.name),
        title: a.reason || (t('artistOpen') + ': ' + (a.name || '')),
      },
        h(Thumb, { src: a.imageUrl, size: 44, round: true, glyph: IconNote }),
        h('span', { className: 'dshm-arow-text' },
          h('span', { className: 'dshm-srow-title dshm-ellipsis' }, a.name || ''),
          a.genreHint ? h('span', { className: 'dshm-srow-sub dshm-ellipsis' }, a.genreHint) : null),
        h('span', { className: 'dshm-arow-arrow', 'aria-hidden': true }, '›'));
    }

    function RecoView({ t, reco, download, player, library, likes, preview, history, openArtistPage, useReco, useDownload, useLibrary, useLikes, usePlayer, useHistory }) {
      const s = useReco((st) => st);
      const histStats = useHistory ? useHistory((st) => st.stats) : null;
      const coldStart = !(histStats && histStats.totalPlays > 0);
      const finishedAt = useDownload((st) => st.finishedAt);
      const tracks = useLibrary((st) => st.tracks);
      const currentId = usePlayer((st) => (st.track ? st.track.id : null));
      const playing = usePlayer((st) => st.playing);
      const [notice, setNotice] = useState('');
      const [styleQ, setStyleQ] = useState('');
      const [styleState, setStyleState] = useState({ status: 'idle', q: '', items: [], interpretedTags: [], fallback: false, message: null, error: null });
      function runStyle() {
        const q = styleQ.trim();
        if (!q || styleState.status === 'loading') return;
        setStyleState({ status: 'loading', q, items: [], interpretedTags: [], fallback: false, message: null, error: null });
        reco.searchStyle(q)
          .then((data) => setStyleState({
            status: 'ready', q,
            items: (data && data.items) || [],
            interpretedTags: (data && data.interpretedTags) || [],
            matchedTerms: (data && data.matchedTerms) || [],
            fallback: !!(data && data.fallback),
            message: (data && data.message) || null,
            error: null,
          }))
          .catch((err) => setStyleState({ status: 'error', q, items: [], interpretedTags: [], fallback: false, message: null, error: (err && err.message) || String(err) }));
      }
      // Finished downloads trigger a client-side library refresh as well; the
      // Host rescans on its side, this only picks the new rows up sooner.
      useEffect(() => { if (finishedAt) library.load(); }, [finishedAt]);
      useEffect(() => { reco.load(); }, []);
      function findLocal(item) {
        return (item.trackId && tracks.find((tr) => tr.id === item.trackId))
          || tracks.find((tr) =>
            normalizeZh(tr.artist) === normalizeZh(item.artist) &&
            normalizeZh(tr.title) === normalizeZh(item.title));
      }
      function onPlay(item) {
        playSong(item, player, tracks, preview, setNotice, t);
      }
      /* Clicking a row queues the whole visible list (deduped local matches)
       * and jumps straight to the clicked song; preview-only items fall back
       * to the single-song preview flow. */
      function playListFrom(list, item) {
        const localTracks = [];
        let at = 0;
        for (const it of list) {
          const lc = findLocal(it);
          if (!lc || localTracks.some((tr) => tr.id === lc.id)) continue;
          if (it === item) at = localTracks.length;
          localTracks.push(lc);
        }
        if (localTracks.length) player.playTracks(localTracks, at);
        else if (list.length) onPlay(item || list[0]);
      }
      function playColumn(list) { playListFrom(list, null); }

      const sections = s.sections || { today: s.items, artist: [], new: [] };
      const styleActive = styleState.status !== 'idle';

      function isCur(item) {
        const lc = findLocal(item);
        return lc ? currentId === lc.id : currentId === ('preview:' + likeKey(item));
      }
      function songRows(list, showReason) {
        if (!list.length) return h('div', { className: 'dshm-lyrics-hint' }, t('recoSectionEmpty'));
        return list.map((item, i) => h(SongRow, {
          key: i, t, item, likes, useLikes, onPlay: (it) => playListFrom(list, it), onOpenArtist: openArtistPage, showReason,
          isCurrent: isCur(item), playing,
        }));
      }
      function column(headKey, icon, list, extraHead) {
        return h('section', { className: 'dshm-column', key: headKey },
          h('div', { className: 'dshm-col-head' },
            h('div', { className: 'dshm-col-title' }, h(icon, { size: 14 }), t(headKey)),
            h('span', { className: 'dshm-col-count' }, list.length + ' ' + t('tracksUnit')),
            extraHead),
          h('div', { className: 'dshm-col-list' }, songRows(list, true)));
      }

      const toolbar = h('div', { className: 'dshm-toolbar dshm-toolbar-flat' },
        h('label', { className: 'dshm-search', style: { maxWidth: '280px' } },
          h(IconSearch, { size: 15 }),
          h('input', {
            type: 'search', value: styleQ, placeholder: t('stylePlaceholder'),
            'aria-label': t('styleBtn'),
            onChange: (e) => setStyleQ(e.target.value),
            onKeyDown: (e) => { if (e.key === 'Enter') runStyle(); },
          })),
        h('button', { type: 'button', className: 'dshm-chipbtn', disabled: !styleQ.trim(), onClick: runStyle }, t('styleBtn')),
        notice ? h('span', { className: 'dshm-mode-hint', style: { margin: '0 0 0 8px', flex: '1', minWidth: '120px' } }, notice) : null,
        h('button', {
          type: 'button', className: 'dshm-chipbtn', style: { marginLeft: 'auto' },
          disabled: s.status === 'generating', onClick: () => reco.generate(),
        }, h(IconSparkles, { size: 13 }), t('recoRegenerate')));

      if (s.status === 'generating') {
        return h('div', { className: 'dshm-reco-page' }, toolbar,
          h('div', { className: 'dshm-columns' },
            [0, 1, 2].map((i) => h('section', { className: 'dshm-column', key: i },
              h('div', { className: 'dshm-col-head' },
                h('div', { className: 'dshm-col-title' }, h(IconSparkles, { size: 14, className: 'dshm-state-spin' }), t('recoGenerating'))),
              h('div', { className: 'dshm-col-list' }, h(SkeletonRows))))));
      }
      if (s.status === 'error') {
        return h('div', { className: 'dshm-reco-page' }, toolbar,
          h(EmptyState, {
            icon: h(IconAlert, { size: 30 }), tone: 'error',
            title: t('recoError'), body: s.error || '',
          }, h('button', { type: 'button', className: 'dshm-chipbtn', onClick: () => reco.generate() }, t('lyricsRetry'))));
      }
      if (!styleActive && s.status !== 'ready' && !s.sections) {
        return h('div', { className: 'dshm-reco-page' }, toolbar,
          h(EmptyState, {
            icon: h(IconSparkles, { size: 30 }),
            title: coldStart ? t('recoColdTitle') : t('recoEmptyTitle'),
            body: coldStart ? t('recoColdBody') : t('recoEmptyBody'),
          }, h('button', { type: 'button', className: 'dshm-chipbtn dshm-chipbtn-primary', onClick: () => reco.generate() },
            h(IconSparkles, { size: 14 }), t('recoGenerate'))));
      }
      if (styleActive) {
        return h('div', { className: 'dshm-reco-page' }, toolbar,
          styleState.status === 'loading'
            ? h('div', { className: 'dshm-state' },
                h('div', { className: 'dshm-state-icon' }, h(IconSparkles, { size: 30, className: 'dshm-state-spin' })),
                h('div', { className: 'dshm-state-title' }, t('styleLoading')))
            : styleState.status === 'error'
              ? h(EmptyState, { icon: h(IconAlert, { size: 30 }), tone: 'error', title: t('styleError'), body: styleState.error || '' },
                  h('button', { type: 'button', className: 'dshm-chipbtn', onClick: runStyle }, t('lyricsRetry')))
              : h(React.Fragment, null,
                  h('div', { className: 'dshm-acard-meta', style: { padding: '10px 4px 0' } },
                    h('button', { type: 'button', className: 'dshm-chipbtn', onClick: () => setStyleState({ status: 'idle', q: '', items: [], interpretedTags: [], fallback: false, message: null, error: null }) }, t('backToReco')),
                    h('button', {
                      type: 'button', className: 'dshm-chipbtn dshm-chipbtn-primary',
                      disabled: styleState.items.length === 0,
                      title: t('playList'),
                      onClick: () => playListFrom(styleState.items, null),
                    }, h(IconPlay, { size: 12 }), t('playList')),
                    styleState.interpretedTags.length
                      ? h('span', null, t('interpretedAs') + '：'
                        + (styleState.matchedTerms && styleState.matchedTerms.length
                          ? styleState.matchedTerms.join('、') + ' → '
                          : '')
                        + styleState.interpretedTags.join(' / '))
                      : null,
                    styleState.message
                      ? h('span', { className: 'dshm-sim-chip-reason' }, styleState.message)
                      : null),
                  h('div', { className: 'dshm-col-list', style: { maxHeight: 'none' } }, songRows(styleState.items, true))));
      }
      return h('div', { className: 'dshm-reco-page', style: { padding: '12px 16px 0', display: 'flex', flexDirection: 'column' } },
        toolbar,
        h(DownloadPanel, { t, download, useDownload }),
        s.bootstrapNote
          ? h('div', { className: 'dshm-explore-note', role: 'note' },
              h(IconSparkles, { size: 13 }),
              h('span', { className: 'dshm-explore-chip' }, t('exploreChip')),
              h('span', null, s.bootstrapNote))
          : null,
        h('div', { className: 'dshm-columns' },
          column('colToday', IconSparkles, sections.today || [],
            h('button', {
              type: 'button', className: 'dshm-chipbtn dshm-col-play',
              disabled: !(sections.today || []).length,
              onClick: () => playColumn(sections.today || []),
            }, h(IconPlay, { size: 12 }), t('playColumn'))),
          h('section', { className: 'dshm-column', key: 'colArtist' },
            h('div', { className: 'dshm-col-head' },
              h('div', { className: 'dshm-col-title' }, h(IconNote, { size: 14 }), t('colArtist')),
              h('span', { className: 'dshm-col-count' }, (sections.artist || []).length + ' ' + t('tracksUnit'))),
            h('div', { className: 'dshm-col-list' },
              (sections.artist || []).length === 0
                ? h('div', { className: 'dshm-lyrics-hint' }, t('recoSectionEmpty'))
                : (sections.artist || []).map((a, i) => h(ArtistTile, { key: i, t, a, onOpen: openArtistPage })))),
          column('colNew', IconDisc, sections.new || [],
            h('button', {
              type: 'button', className: 'dshm-chipbtn dshm-col-play',
              disabled: !(sections.new || []).length,
              onClick: () => playColumn(sections.new || []),
            }, h(IconPlay, { size: 12 }), t('playColumn')))));
    }

    /* Shared artist profile block (intro / news / trivia / similar), reused by
     * the S2 drawer and the V3 full artist page. */
    function ArtistProfileSections({ t, data, onOpenArtist, artistImages, useArtistImages }) {
      if (!data) return null;
      const items = (list) => (list && list.length ? list : null);
      return h(React.Fragment, null,
        data.intro && data.intro.text
          ? h('section', { className: 'dshm-asec' },
              h('div', { className: 'dshm-asec-title' }, h(IconNote, { size: 13 }), t('artistIntro')),
              h('div', { className: 'dshm-acard' },
                h('div', { className: 'dshm-acard-text' }, data.intro.text),
                h(CiteMeta, { item: data.intro, t })))
          : null,
        h('section', { className: 'dshm-asec' },
          h('div', { className: 'dshm-asec-title' }, h(IconSparkles, { size: 13 }), t('artistNews')),
          items(data.news)
            ? data.news.map((n, i) => h('div', { className: 'dshm-acard', key: i },
                h('div', { className: 'dshm-acard-text' }, n.text),
                h(CiteMeta, { item: n, t })))
            : h('div', { className: 'dshm-lyrics-hint' }, (data && data.message) || t('noSection'))),
        h('section', { className: 'dshm-asec' },
          h('div', { className: 'dshm-asec-title' }, h(IconQueue, { size: 13 }), t('artistTrivia')),
          items(data.trivia)
            ? data.trivia.map((n, i) => h('div', { className: 'dshm-acard', key: i },
                h('div', { className: 'dshm-acard-text' }, n.text),
                h('div', { className: 'dshm-acard-meta' },
                  n.kind ? h('span', { className: 'dshm-kind-chip' }, n.kind === 'rumor' ? t('kindRumor') : t('kindFact')) : null,
                  h('span', null, (n.source || '') + (n.date ? ' · ' + n.date : '')),
                  n.url ? h('a', { href: n.url, target: '_blank', rel: 'noreferrer noopener' }, t('citeLink')) : null)))
            : h('div', { className: 'dshm-lyrics-hint' }, t('noSection'))),
        h('section', { className: 'dshm-asec' },
          h('div', { className: 'dshm-asec-title' }, h(IconDisc, { size: 13 }), t('artistSimilarArtists')),
          items(data.similarArtists)
            ? data.similarArtists.map((s, i) => h('button', {
                key: i, type: 'button', className: 'dshm-sim-chip',
                title: s.reason || '', onClick: () => onOpenArtist(s.name),
              },
                h(ArtistAvatar, { name: s.name, size: 18, service: artistImages, useArtistImages }),
                h('span', null, s.name),
                s.reason ? h('span', { className: 'dshm-sim-chip-reason' }, s.reason) : null))
            : h('div', { className: 'dshm-lyrics-hint' }, t('noSection'))),
        items(data.similarSongs)
          ? h('section', { className: 'dshm-asec' },
              h('div', { className: 'dshm-asec-title' }, h(IconPlay, { size: 13 }), t('artistSimilarSongs')),
              data.similarSongs.map((s, i) => h('div', { className: 'dshm-acard', key: i },
                h('div', { className: 'dshm-acard-text' }, (s.title || '') + (s.artist ? ' · ' + s.artist : '')),
                s.reason ? h('div', { className: 'dshm-sim-chip-reason' }, s.reason) : null,
                h(CiteMeta, { item: s, t }))))
          : null);
    }

    /* ================================================================
     * 11a2. Artist page (V3): profile + songs, play/preview + like
     * ================================================================ */
    function ArtistPageView({ t, reco, player, likes, preview, library, openView, openArtistPage, artistImages, useUi, useLikes, useLibrary, usePlayer, useArtistImages }) {
      const name = useUi((s) => s.artistName);
      const tracks = useLibrary((st) => st.tracks);
      const currentId = usePlayer((st) => (st.track ? st.track.id : null));
      const playing = usePlayer((st) => st.playing);
      const [st, setSt] = useState({ status: 'loading', data: null, error: null });
      const [notice, setNotice] = useState('');
      useEffect(() => {
        if (!name) return undefined;
        let dead = false;
        setSt({ status: 'loading', data: null, error: null });
        reco.artistPage(name)
          .then((data) => { if (!dead) setSt({ status: 'ready', data, error: null }); })
          .catch((err) => { if (!dead) setSt({ status: 'error', data: null, error: (err && err.message) || String(err) }); });
        return () => { dead = true; };
      }, [name]);
      function onPlaySong(item) {
        playSong(item, player, tracks, preview, setNotice, t);
      }
      function isCur(item) {
        const lc = (item.trackId && tracks.find((tr) => tr.id === item.trackId))
          || tracks.find((tr) => normalizeZh(tr.artist) === normalizeZh(item.artist) && normalizeZh(tr.title) === normalizeZh(item.title));
        return lc ? currentId === lc.id : currentId === ('preview:' + likeKey(item));
      }
      const data = st.data || {};
      const profile = data.profile || null;
      /* 横幅用专用 bannerUrl（适中尺寸，避免 10MB 原图白屏），头像用缩略图；
       * 兼容顶层字段与 profile 内嵌两种形态。 */
      const heroImg = data.bannerUrl || data.imageUrl || (profile && profile.imageUrl) || null;
      const thumbImg = data.thumbnailUrl || (profile && (profile.imageUrl || profile.thumbnailUrl)) || heroImg;
      const songs = data.songs || [];
      const ready = st.status === 'ready';
      /* Row click queues the whole artist song list and jumps to that song. */
      function playListFrom(list, item) {
        const localTracks = [];
        let at = 0;
        for (const it of list) {
          const lc = (it.trackId && tracks.find((tr) => tr.id === it.trackId))
            || tracks.find((tr) => normalizeZh(tr.artist) === normalizeZh(it.artist) && normalizeZh(tr.title) === normalizeZh(it.title));
          if (!lc || localTracks.some((tr) => tr.id === lc.id)) continue;
          if (it === item) at = localTracks.length;
          localTracks.push(lc);
        }
        if (localTracks.length) player.playTracks(localTracks, at);
        else if (list.length) onPlaySong(item || list[0]);
      }
      return h('div', { className: 'dshm-apage' },
        h('div', { className: 'dshm-toolbar dshm-toolbar-flat' },
          h('button', { type: 'button', className: 'dshm-chipbtn', onClick: () => openView('reco') }, '← ' + t('artistPageBack')),
          notice ? h('span', { className: 'dshm-mode-hint', style: { marginLeft: '8px' } }, notice) : null,
          library && ready ? h('button', {
            type: 'button', className: 'dshm-chipbtn', disabled: !songs.length,
            style: { marginLeft: 'auto' },
            title: t('playList'),
            onClick: () => playListFrom(songs, null),
          }, h(IconPlay, { size: 12 }), t('playList')) : null),
        st.status === 'loading'
          ? h('div', { className: 'dshm-state' },
              h('div', { className: 'dshm-state-icon' }, h(IconNote, { size: 30 })),
              h('div', { className: 'dshm-state-title' }, t('artistLoading')))
          : st.status === 'error'
            ? h(EmptyState, { icon: h(IconAlert, { size: 30 }), tone: 'error', title: t('artistError'), body: st.error || '' })
            : h(React.Fragment, null,
                h('div', { className: 'dshm-apage-banner', 'aria-hidden': true },
                  heroImg
                    ? h('img', {
                        src: imgUrl(heroImg), alt: '', loading: 'lazy', draggable: false,
                        onError: (e) => { e.currentTarget.style.display = 'none'; },
                      })
                    : null,
                  h('div', { className: 'dshm-apage-banner-mask' }),
                  h(IconNote, { size: 28 })),
                h('div', { className: 'dshm-apage-hero' },
                  h('div', { className: 'dshm-apage-ava-wrap', 'aria-hidden': true },
                    h(Thumb, { src: thumbImg, size: 96, round: true, glyph: IconNote })),
                  h('div', { style: { minWidth: 0 } },
                    h('h2', { className: 'dshm-apage-name dshm-ellipsis' }, name || ''),
                    h('div', { className: 'dshm-count' }, songs.length + ' ' + t('artistSongs')))),
                profile
                  ? h(ArtistProfileSections, { t, data: profile, onOpenArtist: openArtistPage, artistImages, useArtistImages })
                  : null,
                h('section', { className: 'dshm-asec', style: { marginTop: '18px' } },
                  h('div', { className: 'dshm-asec-title' }, h(IconPlay, { size: 13 }), t('artistSongs')),
                  songs.length === 0
                    ? h('div', { className: 'dshm-lyrics-hint' }, t('artistNoSongs'))
                    : h('div', { className: 'dshm-col-list', style: { maxHeight: 'none' } },
                        songs.map((item, i) => h(SongRow, {
                          key: i, t, item, likes, useLikes,
                          onPlay: (it) => playListFrom(songs, it), onOpenArtist: openArtistPage, showReason: false,
                          isCurrent: isCur(item), playing,
                        }))))));
    }

    /* ================================================================
     * 11b. Spotify sync panel (S3): trigger + result chips
     * ================================================================ */
    function SyncPanel({ t, sync, useSync }) {
      const s = useSync((st) => st);
      if (s.phase === 'idle' && !s.result && !s.error) return null;
      const r = s.result || {};
      const chips = [
        ['syncCloud', r.cloud], ['syncAdded', r.added], ['syncRemoved', r.removed],
        ['syncOk', r.ok], ['syncFail', r.fail], ['syncMissing', r.missing],
      ];
      const problems = (s.tracks || []).filter((tr) => tr && (tr.status === 'fail' || tr.status === 'missing'));
      return h('div', { className: 'dshm-sync', role: 'status' },
        h('div', { className: 'dshm-asec-title' }, h(IconRefresh, { size: 13, className: s.phase === 'running' ? 'dshm-spin' : undefined }),
          s.phase === 'running' ? t('syncing') : s.phase === 'error' ? t('syncError') : t('syncBtn')),
        s.error ? h('div', { className: 'dshm-errorline', role: 'alert' }, h(IconAlert, { size: 14 }), s.error) : null,
        s.phase !== 'running' && s.result
          ? h('div', { className: 'dshm-sync-chips' },
              chips.map(([key, value]) => h('span', { className: 'dshm-sync-chip', key },
                t(key) + ' ' + (value == null ? '—' : value))))
          : null,
        problems.length
          ? h('div', { className: 'dshm-sync-detail' },
              problems.slice(0, 8).map((tr, i) => h('div', { key: i },
                (tr.status === 'fail' ? '✕ ' : '⚠ ') + (tr.artist || '') + ' - ' + (tr.title || '') + (tr.note ? '（' + tr.note + '）' : ''))),
              problems.length > 8 ? h('div', null, '… +' + (problems.length - 8)) : null)
          : null);
    }

    /* ================================================================
     * 11c. History view (S3): plays, completion, skips
     * ================================================================ */
    function fmtDuration(sec) {
      const v = Math.max(0, Math.round(sec || 0));
      const hh = Math.floor(v / 3600), mm = Math.floor((v % 3600) / 60);
      return hh > 0 ? hh + ' 小时 ' + mm + ' 分' : mm + ' 分 ' + (v % 60) + ' 秒';
    }

    function dayKeyOf(ts) {
      const d = new Date(ts || Date.now());
      return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
    }

    function HistoryView({ t, history, player, openArtistPage, artistImages, useHistory, useLibrary, useArtistImages }) {
      const s = useHistory((st) => st);
      const [notice, setNotice] = useState('');
      const tracks = useLibrary ? useLibrary((st) => st.tracks) : [];
      useEffect(() => { history.load(50); }, []);
      const stats = s.stats;
      const coverOf = (ev) => {
        const tr = ev.trackId && tracks.find((x) => x.id === ev.trackId);
        return tr && tr.coverUrl ? tr.coverUrl : null;
      };
      const statCard = (label, value) => h('div', { className: 'dshm-stat', key: label },
        h('div', { className: 'dshm-stat-value dshm-ellipsis' }, value),
        h('div', { className: 'dshm-stat-label' }, label));
      const trackForTop = (it) => (it && ((it.trackId && tracks.find((x) => x.id === it.trackId)) || (it.id && tracks.find((x) => x.id === it.id)))) || null;
      const topTracks = [];
      for (const it of (stats && stats.topSongs) || []) {
        const tr = trackForTop(it);
        if (tr && !topTracks.some((x) => x.id === tr.id)) topTracks.push(tr);
      }
      const playTopSong = (it) => {
        const tr = trackForTop(it);
        if (!tr) return;
        const idx = topTracks.findIndex((x) => x.id === tr.id);
        player.playTracks(topTracks, idx >= 0 ? idx : 0);
      };
      const daily = (stats && stats.daily) || [];
      const maxPlays = Math.max(1, ...daily.map((d) => d.plays || 0));
      const statsBlock = stats
        ? h('div', { className: 'dshm-stats-wrap' },
            h('div', { className: 'dshm-stats' },
              statCard(t('statPlays'), String(stats.totalPlays || 0)),
              statCard(t('statSeconds'), fmtDuration(stats.totalSeconds)),
              statCard(t('statSongs'), String(stats.uniqueSongs || 0)),
              statCard(t('statArtists'), String(stats.uniqueArtists || 0)),
              statCard(t('statSkipped'), String(stats.skippedCount || 0)),
              statCard(t('statCompletion'), Math.round((stats.avgCompletion || 0) * 100) + '%')),
            h('div', { className: 'dshm-trend' },
              h('div', { className: 'dshm-asec-title' }, h(IconQueue, { size: 13 }), t('trendTitle')),
              h('div', { className: 'dshm-bars' }, daily.map((d, i) => h('div', { className: 'dshm-bar-col', key: i },
                h('div', { className: 'dshm-bar', title: (d.date || '') + ' · ' + (d.plays || 0) + ' ' + t('playsUnit'), style: { height: Math.max(3, Math.round(((d.plays || 0) / maxPlays) * 100)) + '%' } }),
                h('div', { className: 'dshm-bar-label' }, String(d.date || '').slice(5)))))),
            h('div', { className: 'dshm-tops' },
              h('div', { className: 'dshm-top-col' },
                h('div', { className: 'dshm-asec-title' }, h(IconNote, { size: 13 }), t('topSongs'),
                  h('button', {
                    type: 'button', className: 'dshm-chipbtn dshm-col-play', style: { marginLeft: 'auto' },
                    disabled: topTracks.length === 0, title: t('playList'),
                    onClick: () => player.playTracks(topTracks, 0),
                  }, h(IconPlay, { size: 12 }), t('playList'))),
                ((stats.topSongs || []).length
                  ? stats.topSongs.map((it, i) => {
                      const tr = trackForTop(it);
                      const play = () => { setNotice(''); playTopSong(it); };
                      const explain = () => setNotice(t('topUnplayable'));
                      return h('div', {
                        className: cx('dshm-top-row', tr ? 'dshm-top-row-click' : 'dshm-top-row-off'), key: i,
                        role: 'button', tabIndex: 0,
                        'aria-disabled': tr ? undefined : true,
                        title: tr ? t('playTrack') : t('topUnplayable'),
                        onClick: tr ? play : explain,
                        onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tr) play(); else explain(); } },
                      },
                        h('span', { className: 'dshm-top-rank' }, String(i + 1)),
                        h('span', { className: 'dshm-ellipsis', style: { flex: 1 } }, (it.title || '') + (it.artist ? ' · ' + it.artist : '')),
                        h('span', { className: 'dshm-count' }, (it.plays || 0) + ' ' + t('playsUnit')));
                    })
                  : h('div', { className: 'dshm-lyrics-hint' }, t('noSection')))),
              h('div', { className: 'dshm-top-col' },
                h('div', { className: 'dshm-asec-title' }, h(IconDisc, { size: 13 }), t('topArtists')),
                ((stats.topArtists || []).length
                  ? stats.topArtists.map((it, i) => h('button', {
                      key: i, type: 'button', className: 'dshm-top-row dshm-top-row-artist',
                      title: t('artistOpen'), onClick: () => openArtistPage(it.name || ''),
                    },
                      h('span', { className: 'dshm-top-rank' }, String(i + 1)),
                      h('span', { className: 'dshm-ellipsis', style: { flex: 1 } }, it.name || ''),
                      h('span', { className: 'dshm-count' }, (it.plays || 0) + ' ' + t('playsUnit'))))
                  : h('div', { className: 'dshm-lyrics-hint' }, t('noSection'))))))
        : null;

      let list;
      if (s.status === 'loading' && s.events.length === 0) {
        list = h(React.Fragment, null,
          h('div', { className: 'dshm-lyrics-hint' }, t('historyLoading')),
          h(SkeletonRows));
      } else if (s.status === 'error' && s.events.length === 0) {
        list = h(EmptyState, {
          icon: h(IconAlert, { size: 30 }), tone: 'error',
          title: t('historyError'), body: s.error || '',
        }, h('button', { type: 'button', className: 'dshm-chipbtn', onClick: () => history.load(50) }, t('lyricsRetry')));
      } else if (s.events.length === 0) {
        list = h(EmptyState, { icon: h(IconQueue, { size: 30 }), title: t('historyEmpty') });
      } else {
        const groups = [];
        let last = null;
        for (const ev of s.events) {
          const k = dayKeyOf(ev.timestamp || Date.now());
          if (k !== last) { groups.push({ key: k, label: k, items: [] }); last = k; }
          groups[groups.length - 1].items.push(ev);
        }
        const trackById = (ev) => (ev && ev.trackId ? tracks.find((x) => x.id === ev.trackId) : null);
        const queue = [];
        for (const ev of s.events) {
          const tr = trackById(ev);
          if (tr && !queue.some((x) => x.id === tr.id)) queue.push(tr);
        }
        const playHistory = (ev) => {
          const tr = trackById(ev);
          if (!tr) return;
          const idx = queue.findIndex((x) => x.id === tr.id);
          player.playTracks(queue, idx >= 0 ? idx : 0);
        };
        list = h('div', { className: 'dshm-hlist' },
          h('div', { className: 'dshm-queue-head' }, h(IconQueue, { size: 14 }), t('historyTitle'),
            h('span', { className: 'dshm-count' }, s.total + ' ' + t('tracksUnit')),
            h('button', {
              type: 'button', className: 'dshm-chipbtn dshm-col-play', style: { marginLeft: 'auto' },
              disabled: queue.length === 0,
              title: t('playList'),
              onClick: () => player.playTracks(queue, 0),
            }, h(IconPlay, { size: 12 }), t('playList'))),
          groups.map((g) => h('section', { className: 'dshm-hgroup', key: g.key },
            h('div', { className: 'dshm-hgroup-label' },
              g.label,
              h('span', { className: 'dshm-count' }, g.items.length + ' ' + t('playsUnit'))),
            g.items.map((ev, i) => {
              const pct = Math.round((ev.completion || 0) * 100);
              const tone = pct >= 80 ? 'good' : pct >= 40 ? 'mid' : 'low';
              const tr = trackById(ev);
              return h('div', {
                className: cx('dshm-hrow', tr && 'dshm-hrow-click'), key: i,
                role: tr ? 'button' : undefined, tabIndex: tr ? 0 : undefined,
                title: tr ? t('playTrack') : undefined,
                onClick: tr ? () => playHistory(ev) : undefined,
                onKeyDown: tr ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); playHistory(ev); } } : undefined,
              },
                h(Thumb, { src: coverOf(ev), size: 40 }),
                h('div', { className: 'dshm-row-info' },
                  h('div', { className: 'dshm-row-title dshm-ellipsis' }, ev.title || ev.trackId || ''),
                  ev.artist
                    ? h('button', {
                        type: 'button', className: 'dshm-row-sub dshm-ellipsis dshm-row-sub-btn',
                        title: t('artistOpen'), onClick: (e) => { e.stopPropagation(); openArtistPage(ev.artist); },
                      },
                        h(ArtistAvatar, { name: ev.artist, size: 16, service: artistImages, useArtistImages }),
                        h('span', { className: 'dshm-ellipsis' }, ev.artist))
                    : h('div', { className: 'dshm-row-sub dshm-ellipsis' }, '')),
                h('span', { className: 'dshm-hbadge dshm-hbadge-' + tone, title: t('historyComplete') }, pct + '%'),
                ev.skipped ? h('span', { className: 'dshm-hskip' }, t('historySkipped')) : h('span', null),
                h('span', { className: 'dshm-htime' },
                  ev.timestamp ? new Date(ev.timestamp).toLocaleString(undefined, { hour: '2-digit', minute: '2-digit' }) : ''));
            }))));
      }
      return h('div', { className: 'dshm-history-page' },
        notice ? h('div', { className: 'dshm-mode-hint', role: 'status', style: { margin: '6px 8px 0' } }, notice) : null,
        statsBlock, list);
    }

    /* ================================================================
     * 11b. Lyrics panel (S2): synced LRC highlight + auto-scroll
     * ================================================================ */
    function lyricsSourceLabel(source, t) {
      if (source === 'embedded') return t('lyricsSourceEmbedded');
      if (source === 'lrclib') return t('lyricsSourceLrclib');
      if (source === 'web') return t('lyricsSourceWeb');
      return source || '';
    }

    function LyricsPanel({ t, lyrics, useLyrics, usePlayer }) {
      const track = usePlayer((s) => s.track);
      const position = usePlayer((s) => s.position);
      const trackId = track ? track.id : null;
      const snap = useLyrics((s) => (s.trackId === trackId ? s : null));

      useEffect(() => { if (trackId) lyrics.load(trackId); }, [trackId]);

      const scrollRef = useRef(null);
      const activeRef = useRef(null);
      const lines = snap && snap.data && snap.data.synced ? snap.data.lines : null;
      let activeIdx = -1;
      if (lines && lines.length) {
        for (let i = 0; i < lines.length; i++) {
          const tm = lines[i].time;
          if (tm == null) continue;
          if (position + 0.2 >= tm) activeIdx = i;
          else break;
        }
      }
      useEffect(() => {
        const el = activeRef.current, box = scrollRef.current;
        if (el && box) {
          box.scrollTo({
            top: el.offsetTop - box.clientHeight / 2 + el.clientHeight / 2,
            behavior: 'smooth',
          });
        }
      }, [activeIdx]);

      if (!track || !snap) return null;

      let body;
      if (snap.status === 'loading') {
        body = h('div', { className: 'dshm-lyrics-hint' }, t('lyricsLoading'));
      } else if (snap.status === 'error') {
        body = h(React.Fragment, null,
          h('div', { className: 'dshm-errorline', role: 'alert' }, h(IconAlert, { size: 14 }), t('lyricsError') + '：' + snap.error),
          h('button', { type: 'button', className: 'dshm-chipbtn', style: { alignSelf: 'flex-start', margin: '6px 10px 0' }, onClick: () => lyrics.load(trackId) }, t('lyricsRetry')));
      } else if (snap.data && snap.data.source === 'none') {
        body = h('div', { className: 'dshm-lyrics-hint' }, (snap.data.message || t('lyricsNone')));
      } else if (lines && lines.length) {
        body = h('div', { className: 'dshm-lyrics-scroll', ref: scrollRef },
          lines.map((line, i) => h('div', {
            key: i,
            ref: i === activeIdx ? activeRef : null,
            className: cx('dshm-lyric-line',
              i === activeIdx && 'dshm-lyric-line-active',
              i < activeIdx && 'dshm-lyric-line-past'),
          }, line.text || '♪')));
      } else if (snap.data && snap.data.plain) {
        body = h('div', { className: 'dshm-plain-lyrics' }, snap.data.plain);
      } else {
        body = h('div', { className: 'dshm-lyrics-hint' }, t('lyricsNone'));
      }

      return h('section', { className: 'dshm-lyrics', 'aria-label': t('lyricsTitle') },
        h('div', { className: 'dshm-lyrics-head' },
          h(IconNote, { size: 14 }),
          t('lyricsTitle'),
          snap.data && snap.data.source && snap.data.source !== 'none'
            ? h('span', { className: 'dshm-source-chip' }, t('lyricsSource') + ' · ' + lyricsSourceLabel(snap.data.source, t))
            : null),
        body);
    }

    /* ================================================================
     * 11c. Artist drawer (S2): intro / news / trivia / similar, cited
     * ================================================================ */
    function CiteMeta({ item, t }) {
      if (!item || (!item.source && !item.date && !item.url)) return null;
      return h('div', { className: 'dshm-acard-meta' },
        h('span', null, (item.source || t('citeSource')) + (item.date ? ' · ' + item.date : '')),
        item.url ? h('a', { href: item.url, target: '_blank', rel: 'noreferrer noopener' }, t('citeLink')) : null);
    }

    /* ================================================================
     * 12. Music panel (main slot): header + tabs + per-view body
     * ================================================================ */
    function MusicPanel({ t, player, library, lyrics, reco, download, sync, history, likes, preview, openView, openArtistPage, setMiniHidden, ui, artistImages, onboarding, useUi, useLibrary, usePlayer, useLyrics, useReco, useDownload, useSync, useHistory, useLikes, usePreview, useArtistImages, useOnboarding }) {
      const view = useUi((s) => s.view);
      const welcomePreview = useUi((s) => s.welcomePreview);
      const onboardingSnap = useOnboarding((st) => st);
      const miniHidden = useUi((s) => s.miniHidden);
      const hasTrack = usePlayer((s) => !!s.track);
      const status = useLibrary((s) => s.status);
      const count = useLibrary((s) => s.tracks.length);
      const playing = usePlayer((s) => s.playing);
      const busy = status === 'loading';

      if (view === 'welcome') {
        return h(WelcomeView, {
          t, onboarding, useOnboarding,
          preview: !!welcomePreview,
          onExitPreview: () => { ui.set({ welcomePreview: false, view: 'library' }); openView('library'); },
          onRoute: (target) => {
            ui.set({ welcomePreview: false });
            if (target === 'library') {
              library.load();
              setTimeout(() => library.load(), 1500);
              openView('library');
            } else openView('reco');
          },
        });
      }

      const tabs = [
        { id: 'library', label: t('tabLibrary') },
        { id: 'reco', label: t('tabReco') },
        { id: 'now', label: t('tabNow'), dot: playing },
        { id: 'history', label: t('tabHistory') },
      ];

      const body = view === 'library'
        ? h(LibraryView, { t, player, library, sync, download, preview, likes, openArtistPage, artistImages, useLikes, useSync, useDownload, useLibrary, usePlayer, useArtistImages })
        : view === 'reco'
          ? h(RecoView, { t, reco, download, player, library, likes, preview, history, openArtistPage, useReco, useDownload, useLibrary, useLikes, usePlayer, useHistory })
          : view === 'artist'
            ? h(ArtistPageView, { t, reco, player, likes, preview, library, openView, openArtistPage, artistImages, useUi, useLikes, useLibrary, usePlayer, useArtistImages })
            : view === 'history'
              ? h(HistoryView, { t, history, player, openArtistPage, artistImages, useHistory, useLibrary, useArtistImages })
              : h(NowPlayingView, { t, player, lyrics, usePlayer, useLyrics, openView, openArtistPage, artistImages, useArtistImages });

      return h(React.Fragment, null,
        h('div', { className: 'dshm-panel' },
          h('header', { className: 'dshm-header' },
            h('div', { className: 'dshm-title-row' },
              h('h1', { className: 'dshm-title' }, t('panel')),
              h('span', { className: 'dshm-count' }, count > 0 ? count + ' ' + t('tracksUnit') : ''),
              h('div', { className: 'dshm-header-actions' },
                onboardingSnap && onboardingSnap.completed
                  ? h('button', {
                      type: 'button', className: 'dshm-chipbtn',
                      title: t('welcomePreview'), onClick: () => ui.set({ view: 'welcome', welcomePreview: true }),
                    }, h(IconSparkles, { size: 12 }), t('welcomePreview'))
                  : null,
                h('button', {
                  type: 'button', className: cx('dshm-chipbtn', !miniHidden && 'dshm-chipbtn-primary'),
                  disabled: miniHidden && !hasTrack,
                  title: miniHidden && !hasTrack ? t('miniNeedsTrack') : (miniHidden ? t('showMini') : t('hideMini')),
                  onClick: () => setMiniHidden(miniHidden ? false : true),
                }, h(IconNote, { size: 14 }), miniHidden ? t('showMini') : t('hideMini')),
                h('button', {
                  type: 'button', className: 'dshm-chipbtn', disabled: busy,
                  onClick: () => library.rescan(),
                }, h(IconRefresh, { size: 14, className: busy ? 'dshm-spin' : undefined }), busy ? t('rescanning') : t('rescan')))),
            h('nav', { className: 'dshm-tabs', role: 'tablist', 'aria-label': t('panel') },
              tabs.map((tab) => h('button', {
                key: tab.id, type: 'button', role: 'tab',
                className: 'dshm-tab', 'aria-selected': view === tab.id,
                onClick: () => openView(tab.id),
              }, tab.label, tab.dot ? h('span', { className: 'dshm-tab-dot', 'aria-hidden': true }) : null)))),
          h('div', { className: 'dshm-body', role: 'tabpanel' }, body)));
    }

    /* ================================================================
     * 13. Sidebar panel icon (sidebar.panellist owner props)
     * ================================================================ */
    function PanelIcon({ size, active }) {
      return h(IconNote, {
        size: size || 18,
        style: { color: active ? 'var(--dsw-alias-brand-text)' : 'currentColor', display: 'block' },
      });
    }

    /* ================================================================
     * 14. Mini player (shell.overlay — mounted across navigation)
     * ================================================================ */
    function MiniPlayer({ t, player, lyrics, artistImages, usePlayer, useUi, useLyrics, useArtistImages, openNow, openArtistPage, setMiniHidden, setMiniCollapsed }) {
      const track = usePlayer((s) => s.track);
      const playing = usePlayer((s) => s.playing);
      const position = usePlayer((s) => s.position);
      const duration = usePlayer((s) => s.duration);
      const error = usePlayer((s) => s.error);
      const hidden = useUi((s) => s.miniHidden);
      const collapsed = useUi((s) => s.miniCollapsed);
      const shuffle = usePlayer((s) => s.shuffle);
      const repeat = usePlayer((s) => s.repeat);
      const mode = modeMeta(t, shuffle, repeat);
      const trackId = track ? track.id : null;
      const snap = useLyrics((s) => (s.trackId === trackId ? s : null));
      const [pos, setPos] = useState(() => readPrefs().miniPos || null);
      const [fabPos, setFabPos] = useState(() => readPrefs().miniFabPos || null);
      const [dragging, setDragging] = useState(false);
      const boxRef = useRef(null);
      const dragRef = useRef(null);
      const posRef = useRef(pos);
      posRef.current = pos;
      const fabRef = useRef(null);
      const fabDragRef = useRef(null);
      const fabPosRef = useRef(fabPos);
      fabPosRef.current = fabPos;
      const fabMoved = useRef(0);

      useEffect(() => { if (trackId) lyrics.load(trackId); }, [trackId]);

      /* Keep dragged positions inside the viewport when the window resizes. */
      useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const clampAll = () => {
          const cur = posRef.current;
          if (cur) {
            const el = boxRef.current;
            const w = el ? el.offsetWidth : 380, hh = el ? el.offsetHeight : 96;
            const next = {
              left: Math.max(0, Math.min(cur.left, window.innerWidth - w - 8)),
              top: Math.max(0, Math.min(cur.top, window.innerHeight - hh - 8)),
            };
            if (next.left !== cur.left || next.top !== cur.top) { setPos(next); writePrefs({ miniPos: next }); }
          }
          const fp = fabPosRef.current;
          if (fp) {
            const next = {
              left: Math.max(0, Math.min(fp.left, window.innerWidth - 56)),
              top: Math.max(0, Math.min(fp.top, window.innerHeight - 56)),
            };
            if (next.left !== fp.left || next.top !== fp.top) { setFabPos(next); writePrefs({ miniFabPos: next }); }
          }
        };
        clampAll();
        window.addEventListener('resize', clampAll);
        return () => window.removeEventListener('resize', clampAll);
      }, []);

      if (!track) return null;
      /* Closed = gone until the panel's 「显示迷你播放条」 brings it back. */
      if (hidden) return null;

      /* ---------------- collapsed: circular floating badge ---------------- */
      if (collapsed) {
        const onFabDown = (e) => {
          const el = fabRef.current;
          if (!el) return;
          e.preventDefault();
          const box = el.getBoundingClientRect();
          fabDragRef.current = { px: e.clientX, py: e.clientY, left: box.left, top: box.top };
          fabMoved.current = 0;
          try { el.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
        };
        const onFabMove = (e) => {
          const d = fabDragRef.current;
          if (!d) return;
          const dx = e.clientX - d.px, dy = e.clientY - d.py;
          fabMoved.current = Math.max(fabMoved.current, Math.abs(dx) + Math.abs(dy));
          if (fabMoved.current < 3) return;
          const next = {
            left: Math.max(0, Math.min(d.left + dx, window.innerWidth - 56)),
            top: Math.max(0, Math.min(d.top + dy, window.innerHeight - 56)),
          };
          fabPosRef.current = next;
          setFabPos(next);
        };
        const onFabUp = (e) => {
          if (!fabDragRef.current) return;
          fabDragRef.current = null;
          if (fabMoved.current < 5) { setMiniCollapsed(false); return; }
          if (fabPosRef.current) writePrefs({ miniFabPos: fabPosRef.current });
          try { if (fabRef.current) fabRef.current.releasePointerCapture(e.pointerId); } catch { /* released */ }
        };
        const fabStyle = fabPos ? { left: fabPos.left, top: fabPos.top, right: 'auto', bottom: 'auto' } : undefined;
        return portalToBody(h('div', {
          ref: fabRef, style: fabStyle,
          className: cx('dshm-mini-fab', dragging && 'dshm-mini-fab-dragging'),
          role: 'button', tabIndex: 0,
          title: t('miniExpand'), 'aria-label': t('miniExpand'),
          onPointerDown: onFabDown, onPointerMove: onFabMove,
          onPointerUp: onFabUp, onPointerCancel: onFabUp,
          onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setMiniCollapsed(false); } },
        },
          h(Thumb, { src: track.coverUrl, size: 48, round: true, glyph: IconNote }),
          h('span', { className: 'dshm-mini-fab-badge', 'aria-hidden': true },
            h(playing ? IconPause : IconPlay, { size: 11 }))));
      }

      /* ---------------- expanded: the full mini bar ---------------- */
      const gripDown = (e) => {
        const el = boxRef.current;
        if (!el) return;
        e.preventDefault();
        const box = el.getBoundingClientRect();
        dragRef.current = { px: e.clientX, py: e.clientY, left: box.left, top: box.top, w: box.width, h: box.height };
        setDragging(true);
        try { el.setPointerCapture(e.pointerId); } catch { /* unsupported */ }
      };
      const gripMove = (e) => {
        const d = dragRef.current;
        if (!d) return;
        const next = {
          left: Math.max(0, Math.min(d.left + (e.clientX - d.px), window.innerWidth - d.w - 8)),
          top: Math.max(0, Math.min(d.top + (e.clientY - d.py), window.innerHeight - d.h - 8)),
        };
        posRef.current = next;
        setPos(next);
      };
      const gripUp = (e) => {
        if (!dragRef.current) return;
        dragRef.current = null;
        setDragging(false);
        if (posRef.current) writePrefs({ miniPos: posRef.current });
        try { if (boxRef.current) boxRef.current.releasePointerCapture(e.pointerId); } catch { /* released */ }
      };

      const frac = duration > 0 ? Math.min(1, position / duration) : 0;
      const lines = snap && snap.data && snap.data.synced ? snap.data.lines : null;
      let activeIdx = -1;
      if (lines) {
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].time == null) continue;
          if (position + 0.2 >= lines[i].time) activeIdx = i;
          else break;
        }
      }
      const win = [];
      if (lines && lines.length) {
        const start = activeIdx < 0 ? 0 : Math.max(0, Math.min(activeIdx - 1, lines.length - 3));
        for (let i = start; i < Math.min(lines.length, start + 3); i++) win.push({ i, text: lines[i].text || '♪' });
      }
      const style = pos ? { left: pos.left, top: pos.top, right: 'auto', bottom: 'auto' } : undefined;
      const activeLine = activeIdx >= 0 && lines && lines[activeIdx] ? (lines[activeIdx].text || '♪') : '';
      const artistBtn = h('button', {
        type: 'button', className: 'dshm-mini-artist',
        title: t('artistOpen'), 'aria-label': t('artistOpen'),
        onClick: (e) => { e.stopPropagation(); openArtistPage(track.artist || ''); },
      },
        track.artist
          ? h(ArtistAvatar, { name: track.artist, size: 14, service: artistImages, useArtistImages })
          : null,
        h('span', { className: 'dshm-ellipsis' }, error ? t('playError') : (track.artist || t('unknownArtist'))));

      return portalToBody(h('div', {
        ref: boxRef, style,
        className: cx('dshm-mini', dragging && 'dshm-mini-dragging'),
        role: 'region', 'aria-label': t('miniLabel'),
      },
        h('div', {
          className: 'dshm-mini-grip', role: 'button', tabIndex: 0,
          title: t('miniDrag'), 'aria-label': t('miniDrag'),
          onPointerDown: gripDown, onPointerMove: gripMove,
          onPointerUp: gripUp, onPointerCancel: gripUp,
          onKeyDown: (e) => {
            const step = 12;
            const cur = posRef.current || (boxRef.current ? { left: boxRef.current.getBoundingClientRect().left, top: boxRef.current.getBoundingClientRect().top } : { left: 0, top: 0 });
            const dl = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
            const dt = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
            if (!dl && !dt) return;
            e.preventDefault();
            const next = { left: Math.max(0, cur.left + dl), top: Math.max(0, cur.top + dt) };
            setPos(next);
            writePrefs({ miniPos: next });
          },
        }, h(IconGrip, { size: 14 })),
        h('div', { className: 'dshm-mini-inner' },
          h('button', {
            type: 'button', className: 'dshm-mini-main',
            onClick: openNow, title: t('openNow'), 'aria-label': t('openNow'),
          },
            h(Cover, { track, size: 36 }),
            h('span', { className: 'dshm-mini-text' },
              h('span', { className: 'dshm-mini-title dshm-ellipsis' }, track.title),
              artistBtn)),
          h('div', { className: 'dshm-mini-controls' },
            h(IconButton, { label: t('prev'), onClick: () => player.prev() }, h(IconPrev, { size: 15 })),
            h(IconButton, {
              label: playing ? t('pause') : t('play'), className: 'dshm-mini-play',
              onClick: () => player.toggle(),
            }, h(playing ? IconPause : IconPlay, { size: 16 })),
            h(IconButton, { label: t('next'), onClick: () => player.next() }, h(IconNext, { size: 15 })),
            h(IconButton, {
              label: mode.label, title: mode.hint + ' · ' + t('modeCycleHint'),
              className: cx((shuffle || repeat === 'one') && 'dshm-iconbtn-active'),
              onClick: () => player.cycleMode(),
            }, h(mode.icon, { size: 15 })),
            h(IconButton, {
              label: t('miniCollapse'), title: t('miniCollapse'),
              onClick: () => setMiniCollapsed(true),
            }, h(IconChevronDown, { size: 15 })),
            h(IconButton, { label: t('hideMini'), title: t('hideMini'), onClick: () => setMiniHidden(true) }, h(IconClose, { size: 13 })))),
        h('div', { className: 'dshm-mini-seek' },
          h(Slider, {
            value: frac, label: t('seekLabel'), disabled: !(duration > 0),
            onChange: (f) => player.seek(f * duration),
          })),
        win.length
          ? h('div', { className: 'dshm-mini-lyrics', 'aria-label': t('miniLyrics') },
              win.map((ln) => h('div', {
                key: ln.i,
                className: cx('dshm-mini-lyric', ln.i === activeIdx && 'dshm-mini-lyric-on'),
                title: ln.text,
              }, ln.text)))
          : null));
    }

    /* ================================================================
     * 15. Plugin body
     * ================================================================ */
    const inject = ['slots', 'locale', 'layout'];

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-music: dictionaries');
      const t = ctx.locale.bind(NS);

      const api = createHostApi(t);
      const library = createLibrary(api);
      const lyricsService = createLyricsService(api);
      const artistService = createArtistService(api);
      const artistImageService = createArtistImageService(api);
      const onboardingService = createOnboardingService(api);
      const recoService = createRecoService(api);
      const downloadService = createDownloadService(api);
      const syncService = createSyncService(api);
      const historyService = createHistoryService(api);
      const player = createPlayer(t, api);
      const previewService = createPreviewService(api);
      const likesService = createLikesService(api, () => downloadService.warm());
      ctx.effect(() => () => {
        downloadService.dispose();
        syncService.dispose();
        previewService.dispose();
      }, 'dsh-music: s3 poll timers');
      downloadService.warm();
      syncService.warm();
      /* First run: open the welcome flow only when the host explicitly says the
       * flow is not completed (a missing endpoint must never interrupt users). */
      onboardingService.load().then((data) => {
        if (data && data.completed === false) ui.set({ view: 'welcome' });
      });
      ctx.effect(() => () => onboardingService.dispose(), 'dsh-music: onboarding timer');
      /* v6 mini-window semantics changed: close now means "hidden until shown".
       * One-time prefs migration makes the mini player visible by default for
       * users whose stored prefs come from the old floating-ball behaviour. */
      const savedPrefs = readPrefs();
      const miniPrefsOk = savedPrefs.miniVersion === 2;
      if (!miniPrefsOk) writePrefs({ miniVersion: 2, miniHidden: false, miniCollapsed: false });
      const ui = createStore({
        view: 'library',
        miniHidden: miniPrefsOk ? !!savedPrefs.miniHidden : false,
        miniCollapsed: miniPrefsOk ? !!savedPrefs.miniCollapsed : false,
        artistName: null,
        welcomePreview: false,
      });
      const openView = (view) => ui.set({ view });
      const openArtistPage = (name) => ui.set({ view: 'artist', artistName: name });
      const setMiniHidden = (hidden) => {
        /* Showing the mini player always restores the full bar (fab -> bar). */
        ui.set(hidden ? { miniHidden: true } : { miniHidden: false, miniCollapsed: false });
        writePrefs(hidden ? { miniHidden: true } : { miniHidden: false, miniCollapsed: false });
      };
      const setMiniCollapsed = (collapsed) => {
        ui.set({ miniCollapsed: collapsed });
        writePrefs({ miniCollapsed: collapsed });
      };

      ctx.effect(() => () => player.dispose(), 'dsh-music: player engine');

      ctx.effect(() => {
        if (typeof document === 'undefined') return () => {};
        const el = document.createElement('style');
        el.setAttribute('data-dsh-music', '');
        el.textContent = CSS;
        document.head.appendChild(el);
        return () => { el.remove(); };
      }, 'dsh-music: styles');

      // Sidebar entry: global "音乐" panel icon.
      ctx.effect(() => ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
        name: 'sidebar.panellist',
        id: PANEL_ID,
        order: 30,
        label: () => t('panel'),
        locale: NS,
      }, PanelIcon)), 'dsh-music: sidebar entry');

      // Main panel keyed by the same id.
      ctx.effect(() => ctx.slots.inject('main', () => ctx.slots.register({
        name: 'main',
        key: PANEL_ID,
        locale: NS,
        inject: () => ({
          player, library, lyrics: lyricsService, artist: artistService, artistImages: artistImageService, onboarding: onboardingService,
          reco: recoService, download: downloadService, sync: syncService, history: historyService,
          likes: likesService, preview: previewService,
          openView, openArtistPage, setMiniHidden, ui,
          hooks: {
            player: player.source, library: library.source, ui,
            lyrics: lyricsService.source, artist: artistService.source, artistImages: artistImageService.source, onboarding: onboardingService.source,
            reco: recoService.source, download: downloadService.source,
            sync: syncService.source, history: historyService.source,
            likes: likesService.source, preview: previewService.source,
          },
        }),
      }, MusicPanel)), 'dsh-music: main panel');

      // Persistent mini player above every column.
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'dsh-music.mini-player',
        locale: NS,
        inject: () => ({
          player, lyrics: lyricsService, artistImages: artistImageService, setMiniHidden, setMiniCollapsed,
          openNow: () => { openView('now'); ctx.layout.selectPanel(PANEL_ID); },
          openArtistPage: (name) => { if (!name) return; openArtistPage(name); ctx.layout.selectPanel(PANEL_ID); },
          hooks: { player: player.source, ui, lyrics: lyricsService.source, artistImages: artistImageService.source },
        }),
      }, MiniPlayer)), 'dsh-music: mini player');

      // Warm the library so the panel opens populated; errors surface in-view.
      library.load();
    }

    return { inject, apply };
  },
});
