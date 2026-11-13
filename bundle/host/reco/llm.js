/** LLM 客户端封装：经 Host 的 ctx.llm 服务生成推荐候选。
 * 契约依据 dsh-llm 源码核实（packages/llm/llm/src/index.ts）：
 *   ctx.llm.stream({ provider, model?, messages }) → async iterable of chunks：
 *     { type:'text-delta', index, text } … { type:'finish', reason:{kind:'stop'|'error'|…, failure?} }
 *   ctx.llm.listProviders() → 同步，已注册 provider 名单
 * 注意：listModels 是 async 且会触发 adapter 解析，无 adapter 的 provider 会产生
 * 绕过同步 try/catch 的 rejection 崩掉 Host——本模块不调用它；model 缺省时由 stream 自选。
 * 失败以 reason.kind!=='stop'/'max-tokens' 终结，读 failure 抛中文错误。 */
const DEFAULT_MAX_TOKENS = 4096

export function createLlmClient({ llm, config = {}, logger } = {}) {
  const warn = (msg) => logger?.warn?.(msg)

  function pickDefault() {
    try {
      const providers = llm.listProviders()
      if (!Array.isArray(providers) || providers.length === 0) return {}
      const provider = typeof providers[0] === 'string' ? providers[0] : providers[0]?.name
      return { provider }
    } catch (err) {
      warn?.(`dsh-music: 读 LLM provider 目录失败: ${err?.message ?? err}`)
      return {}
    }
  }

  /** 一次文本生成。返回纯文本；失败抛中文 Error（含 failure code）。 */
  async function chat(prompt, { maxTokens = Number(config.recoMaxTokens) || DEFAULT_MAX_TOKENS } = {}) {
    if (!llm || typeof llm.stream !== 'function') {
      throw new Error('LLM 服务不可用（插件未注入 llm），无法生成推荐')
    }
    const fallback = pickDefault()
    const provider = config.recoProvider || fallback.provider
    const model = config.recoModel || fallback.model
    if (!provider) throw new Error('没有可用的 LLM provider，无法生成推荐')
    let text = ''
    let finish = null
    try {
      for await (const chunk of llm.stream({
        provider,
        ...(model ? { model } : {}),
        maxTokens,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      })) {
        if (chunk?.type === 'text-delta' && typeof chunk.text === 'string') text += chunk.text
        else if (chunk?.type === 'finish') finish = chunk.reason
      }
    } catch (err) {
      const e = new Error(`LLM 流式调用失败: ${err?.message ?? err}`)
      if (/data_inspection_failed/i.test(String(err?.message ?? err))) e.code = 'CONTENT_FILTER'
      throw e
    }
    if (!finish) throw new Error('LLM 流未返回结束标记')
    if (finish.kind !== 'stop' && finish.kind !== 'max-tokens') {
      const code = finish.failure?.code ?? finish.kind
      const message = String(finish.failure?.message ?? '')
      const e = new Error(`LLM 生成失败（${code}）：${message.slice(0, 160)}`)
      // 内容过滤标记：供 generateInner 触发精简重试（两条错误路径都打标）
      if (code === 'data_inspection_failed' || /data_inspection_failed/i.test(message)) e.code = 'CONTENT_FILTER'
      throw e
    }
    return text
  }

  return { chat }
}
