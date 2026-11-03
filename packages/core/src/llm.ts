import type { TokenUsage } from './types.js'

/**
 * Minimal structural view of `ctx.llm` and its stream protocol. Keeping this
 * local avoids a runtime dependency on the harness packages in the pure core.
 */
export interface LlmProviderLike {
  readonly id: string
}

export interface LlmTextMessage {
  readonly role: 'user'
  readonly content: readonly { readonly type: 'text'; readonly text: string }[]
}

export interface LlmStreamOptions {
  readonly provider: string
  readonly model: string
  readonly system?: string
  readonly messages: readonly LlmTextMessage[]
  readonly temperature?: number
  readonly maxTokens?: number
  readonly signal?: AbortSignal
}

export interface LlmStreamChunk {
  readonly type: string
  readonly text?: string
  readonly usage?: {
    readonly inputTokens?: number
    readonly outputTokens?: number
    readonly totalTokens?: number
  }
  readonly reason?: {
    readonly kind: string
    readonly failure?: { readonly code?: string; readonly message?: string }
  }
}

export interface LlmRuntimeLike {
  listProviders(): readonly LlmProviderLike[]
  stream(options: LlmStreamOptions): AsyncIterable<LlmStreamChunk>
}

export interface LlmCompleteInput {
  readonly system: string
  readonly user: string
  readonly maxTokens: number
  readonly signal?: AbortSignal
}

export interface LlmCompletion {
  readonly text: string
  readonly usage: TokenUsage
  readonly finish: string
  readonly truncated: boolean
}

export interface LlmClient {
  complete(input: LlmCompleteInput): Promise<LlmCompletion>
}

export interface LlmRoute {
  readonly provider: string
  readonly model: string
}

export class LlmRouteError extends Error {
  override readonly name = 'LlmRouteError'
  constructor(
    readonly code: 'NO_PROVIDER' | 'LLM_ERROR' | 'TIMED_OUT' | 'TRUNCATED',
    message: string,
  ) {
    super(message)
  }
}

const FALLBACK_ROUTES: readonly LlmRoute[] = [
  { provider: 'deepseek-account', model: 'deepseek-flash' },
  { provider: 'deepseek-official', model: 'deepseek-flash' },
  { provider: 'deepseek', model: 'deepseek-flash' },
]

/** Prefer the configured route; fall back to known DeepSeek routes when it is not mounted. */
export function resolveRoute(runtime: LlmRuntimeLike, preferred: LlmRoute): LlmRoute {
  const providers = runtime.listProviders()
  if (providers.length === 0) return preferred
  const mounted = new Set(providers.map((provider) => provider.id))
  if (mounted.has(preferred.provider)) return preferred
  for (const route of FALLBACK_ROUTES) {
    if (mounted.has(route.provider)) return route
  }
  throw new LlmRouteError(
    'NO_PROVIDER',
    `no LLM provider is mounted (preferred "${preferred.provider}"; available: ${[...mounted].join(', ') || 'none'})`,
  )
}

/** `ctx.llm.stream` adapter used by both question-point extraction and judging. */
export class DshLlmClient implements LlmClient {
  constructor(
    private readonly runtime: LlmRuntimeLike,
    private readonly route: LlmRoute,
    private readonly timeoutMs: number,
  ) {}

  async complete(input: LlmCompleteInput): Promise<LlmCompletion> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    const signal = input.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, input.signal])

    let text = ''
    let usage: TokenUsage = { input: 0, output: 0 }
    let finish = 'unknown'
    let truncated = false
    try {
      const stream = this.runtime.stream({
        provider: this.route.provider,
        model: this.route.model,
        system: input.system,
        messages: [{ role: 'user', content: [{ type: 'text', text: input.user }] }],
        temperature: 0,
        maxTokens: input.maxTokens,
        signal,
      })
      for await (const chunk of stream) {
        if (chunk.type === 'text-delta' && chunk.text !== undefined) text += chunk.text
        if (chunk.type === 'usage' && chunk.usage !== undefined) {
          usage = {
            input: chunk.usage.inputTokens ?? 0,
            output: chunk.usage.outputTokens ?? 0,
            ...(chunk.usage.totalTokens === undefined ? {} : { total: chunk.usage.totalTokens }),
          }
        }
        if (chunk.type === 'finish') {
          finish = chunk.reason?.kind ?? 'unknown'
          if (finish === 'max-tokens') truncated = true
          if (finish === 'error' || finish === 'aborted') {
            const failure = chunk.reason?.failure
            throw new LlmRouteError('LLM_ERROR', failure?.message ?? `model call ended with ${finish}`)
          }
        }
      }
    } catch (error) {
      if (error instanceof LlmRouteError) throw error
      if (controller.signal.aborted && !signalAbortedByCaller(input.signal)) {
        throw new LlmRouteError('TIMED_OUT', `model call exceeded ${this.timeoutMs}ms`)
      }
      throw new LlmRouteError('LLM_ERROR', error instanceof Error ? error.message : String(error))
    } finally {
      clearTimeout(timer)
    }

    if (text.trim().length === 0) {
      throw new LlmRouteError('LLM_ERROR', 'model returned no text')
    }
    return { text, usage, finish, truncated }
  }
}

function signalAbortedByCaller(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true
}
