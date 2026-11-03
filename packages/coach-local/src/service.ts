import {
  applyHysteresis,
  coverageOf,
  emptyStates,
  matchRuleCoverage,
  parseCoachJson,
  statesFromParsed,
  statesFromRules,
  TrainError,
  type ChainCard,
  type ChainSnapshot,
  type CoachCheckRequest,
  type CoachConfig,
  type CoachConfigResult,
  type CoachProbeResult,
  type CoachScanRequest,
  type GetChainRequest,
  type GetChainResult,
  type LinkState,
  type LlmClient,
  type TrainStore,
} from '@local/dsh-train-core'
import type { ChainRegistry } from './chains.js'
import { buildCoachPrompt } from './prompt.js'

interface CoachState {
  chain: ChainCard
  sessionId: string
  questionId: string
  states: Record<string, LinkState>
  pending: Record<string, number>
  failures: number
  degradedReason?: string
  source: 'rules' | 'model' | 'degraded'
  checkedAt: number
  paragraphIndex?: number
  latencyMs: number
}

export interface CoachServiceOptions {
  /** Returns null when the configured local provider is not mounted; never a cloud client. */
  llm: () => LlmClient | null
  now?: () => number
}

export class CoachService {
  private readonly states = new Map<string, CoachState>()

  constructor(
    private readonly store: TrainStore,
    private readonly registry: ChainRegistry,
    private readonly config: CoachConfig,
    private readonly options: CoachServiceOptions,
  ) {}

  async getChain(request: GetChainRequest): Promise<GetChainResult> {
    const question = await this.store.getQuestion(request.questionId)
    if (question === undefined) throw new TrainError('QUESTION_NOT_FOUND', `question "${request.questionId}" was not found`)
    const chain = this.registry.find(question)
    const providerAvailable = this.provider() !== null
    if (chain === undefined) {
      return { chain: null, snapshot: null, providerAvailable, mode: this.config.mode }
    }
    const state = this.getOrCreate(request.sessionId, request.questionId, chain)
    return {
      chain,
      snapshot: this.snapshot(state, false, 0),
      providerAvailable,
      mode: this.config.mode,
    }
  }

  async scan(request: CoachScanRequest, signal?: AbortSignal): Promise<ChainSnapshot> {
    const question = await this.store.getQuestion(request.questionId)
    if (question === undefined) throw new TrainError('QUESTION_NOT_FOUND', `question "${request.questionId}" was not found`)
    const chain = this.registry.find(question)
    if (chain === undefined) throw new TrainError('CHAIN_NOT_FOUND', `question "${request.questionId}" has no chain card`)
    const state = this.getOrCreate(request.sessionId, request.questionId, chain)
    const started = this.now()
    const provider = this.provider()
    const mayUseModel =
      provider !== null &&
      this.config.mode !== 'rules' &&
      (request.forceModel === true || state.failures < this.config.degradeAfterFailures)
    let flipped = 0
    let discarded = false
    let source: CoachState['source'] = 'rules'

    if (mayUseModel && provider !== null) {
      try {
        const prompt = buildCoachPrompt(chain, request.paragraph, this.coveredLinks(state))
        const completion = await provider.complete({
          system: prompt.system,
          user: prompt.user,
          maxTokens: 256,
          ...(signal === undefined ? {} : { signal }),
        })
        const parsed = parseCoachJson(completion.text, chain)
        if (parsed === null) throw new Error('local model returned no usable link JSON')
        const candidate = statesFromParsed(state.states, parsed)
        flipped = countFlips(state.states, candidate)
        if (state.checkedAt > 0 && flipped >= 3) {
          state.latencyMs = this.now() - started
          state.checkedAt = this.now()
          return this.snapshot(state, true, flipped)
        }
        this.mergeHysteresis(state, candidate)
        state.failures = 0
        state.degradedReason = undefined
        source = 'model'
      } catch (error) {
        state.failures += 1
        state.degradedReason = error instanceof Error ? error.message : String(error)
        this.applyRules(state, matchRuleCoverage(request.content, chain))
        source = 'degraded'
      }
    } else {
      this.applyRules(state, matchRuleCoverage(request.content, chain))
      source = provider !== null && state.failures > 0 ? 'degraded' : 'rules'
    }

    state.source = source
    state.checkedAt = this.now()
    state.paragraphIndex = request.paragraphIndex
    state.latencyMs = this.now() - started
    return this.snapshot(state, discarded, flipped)
  }

  async check(request: CoachCheckRequest, signal?: AbortSignal): Promise<ChainSnapshot> {
    const question = await this.store.getQuestion(request.questionId)
    if (question === undefined) throw new TrainError('QUESTION_NOT_FOUND', `question "${request.questionId}" was not found`)
    const chain = this.registry.find(question)
    if (chain === undefined) throw new TrainError('CHAIN_NOT_FOUND', `question "${request.questionId}" has no chain card`)
    const state = this.getOrCreate(request.sessionId, request.questionId, chain)
    const started = this.now()
    const provider = this.provider()
    let source: CoachState['source'] = 'rules'
    let flipped = 0

    if (provider !== null && this.config.mode !== 'rules' && request.forceModel === true) {
      try {
        const prompt = buildCoachPrompt(chain, request.content.slice(0, this.config.maxParagraphChars), this.coveredLinks(state))
        const completion = await provider.complete({
          system: prompt.system,
          user: prompt.user,
          maxTokens: 320,
          ...(signal === undefined ? {} : { signal }),
        })
        const parsed = parseCoachJson(completion.text, chain)
        if (parsed === null) throw new Error('local model returned no usable link JSON')
        const candidate: Record<string, LinkState> = {}
        for (const link of [...chain.required, ...chain.optional]) {
          if (parsed.covered.includes(link)) candidate[link] = 'covered'
          else if (parsed.uncertain.includes(link)) candidate[link] = 'uncertain'
          else candidate[link] = 'missing'
        }
        flipped = countFlips(state.states, candidate)
        state.states = candidate
        state.pending = {}
        state.failures = 0
        state.degradedReason = undefined
        source = 'model'
      } catch (error) {
        state.failures += 1
        state.degradedReason = error instanceof Error ? error.message : String(error)
        source = 'degraded'
      }
    }

    if (source !== 'model') {
      const covered = matchRuleCoverage(request.content, chain)
      const candidate: Record<string, LinkState> = {}
      for (const link of [...chain.required, ...chain.optional]) candidate[link] = covered.has(link) ? 'covered' : 'missing'
      flipped = countFlips(state.states, candidate)
      state.states = candidate
      state.pending = {}
      source = source === 'degraded' ? 'degraded' : 'rules'
    }

    state.source = source
    state.checkedAt = this.now()
    state.paragraphIndex = undefined
    state.latencyMs = this.now() - started
    return this.snapshot(state, false, flipped)
  }

  async reset(request: GetChainRequest): Promise<{ ok: boolean }> {
    this.states.delete(keyOf(request.sessionId, request.questionId))
    return { ok: true }
  }

  configResult(): CoachConfigResult {
    return {
      provider: this.config.provider,
      model: this.config.model,
      mode: this.config.mode,
      providerAvailable: this.provider() !== null,
      chainCount: this.registry.count,
    }
  }

  async probe(): Promise<CoachProbeResult> {
    const started = this.now()
    const provider = this.provider()
    if (provider === null) {
      return {
        ok: false,
        provider: this.config.provider,
        model: this.config.model,
        latencyMs: 0,
        error: 'NO_PROVIDER: 本地 provider 未挂载',
      }
    }
    try {
      await provider.complete({ system: '你是连通性测试助手。只回复 OK。', user: 'ping', maxTokens: 8 })
      return {
        ok: true,
        provider: this.config.provider,
        model: this.config.model,
        latencyMs: this.now() - started,
      }
    } catch (error) {
      return {
        ok: false,
        provider: this.config.provider,
        model: this.config.model,
        latencyMs: this.now() - started,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private getOrCreate(sessionId: string, questionId: string, chain: ChainCard): CoachState {
    const key = keyOf(sessionId, questionId)
    const existing = this.states.get(key)
    if (existing !== undefined && existing.chain.id === chain.id) return existing
    const state: CoachState = {
      chain,
      sessionId,
      questionId,
      states: emptyStates(chain),
      pending: {},
      failures: 0,
      source: 'rules',
      checkedAt: 0,
      latencyMs: 0,
    }
    this.states.set(key, state)
    return state
  }

  private applyRules(state: CoachState, covered: ReadonlySet<string>): void {
    state.states = statesFromRules(state.states, covered)
    state.pending = {}
  }

  private mergeHysteresis(state: CoachState, candidate: Readonly<Record<string, LinkState>>): void {
    const next = { ...state.states }
    const pending = { ...state.pending }
    for (const link of Object.keys(candidate)) {
      const previous = state.states[link] ?? 'missing'
      const result = applyHysteresis(previous, candidate[link] ?? 'missing', pending[link] ?? 0)
      next[link] = result.state
      pending[link] = result.pending
    }
    state.states = next
    state.pending = pending
  }

  private coveredLinks(state: CoachState): string[] {
    return Object.entries(state.states)
      .filter(([, value]) => value === 'covered')
      .map(([link]) => link)
  }

  private snapshot(state: CoachState, discarded: boolean, flipped: number): ChainSnapshot {
    return {
      sessionId: state.sessionId,
      questionId: state.questionId,
      chainId: state.chain.id,
      chainName: state.chain.name,
      required: state.chain.required,
      optional: state.chain.optional,
      states: state.states,
      coverage: coverageOf(state.chain.required, state.states),
      source: state.source,
      providerAvailable: this.provider() !== null,
      failures: state.failures,
      ...(state.degradedReason === undefined ? {} : { degradedReason: state.degradedReason }),
      checkedAt: state.checkedAt,
      ...(state.paragraphIndex === undefined ? {} : { paragraphIndex: state.paragraphIndex }),
      latencyMs: state.latencyMs,
      discarded,
      flipped,
    }
  }

  private provider(): LlmClient | null {
    try {
      return this.options.llm()
    } catch {
      return null
    }
  }

  private now(): number {
    return (this.options.now ?? Date.now)()
  }
}

function keyOf(sessionId: string, questionId: string): string {
  return `${sessionId}:${questionId}`
}

function countFlips(previous: Readonly<Record<string, LinkState>>, next: Readonly<Record<string, LinkState>>): number {
  let count = 0
  for (const [link, state] of Object.entries(next)) {
    if ((previous[link] ?? 'missing') !== state) count += 1
  }
  return count
}
