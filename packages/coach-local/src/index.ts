import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-llm'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  CoachCheckRequestSchema,
  CoachResetRequestSchema,
  CoachScanRequestSchema,
  DshLlmClient,
  GetChainRequestSchema,
  type ChainSnapshot,
  type CoachCheckRequest,
  type CoachConfig,
  type CoachConfigResult,
  type CoachProbeResult,
  type CoachResetRequest,
  type CoachScanRequest,
  type GetChainRequest,
  type GetChainResult,
  type LlmRuntimeLike,
} from '@local/dsh-train-core'
import { Config, type Config as ConfigShape } from './config.js'
import { ChainRegistry } from './chains.js'
import { CoachService } from './service.js'

export { Config }
export const name = 'train-coach-local'
export const inject = ['llm', 'trainStore']

class CoachRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly service: CoachService,
  ) {
    super(ctx, 'trainCoach', { namespace: 'train' })
  }

  @Remote
  async getChain(request: GetChainRequest): Promise<GetChainResult> {
    return this.service.getChain(GetChainRequestSchema.parse(request))
  }

  @Remote
  async scan(request: CoachScanRequest, signal: AbortSignal): Promise<ChainSnapshot> {
    return this.service.scan(CoachScanRequestSchema.parse(request), signal)
  }

  @Remote
  async check(request: CoachCheckRequest, signal: AbortSignal): Promise<ChainSnapshot> {
    return this.service.check(CoachCheckRequestSchema.parse(request), signal)
  }

  @Remote
  async reset(request: CoachResetRequest): Promise<{ ok: boolean }> {
    return this.service.reset(CoachResetRequestSchema.parse(request))
  }

  @Remote
  async config(): Promise<CoachConfigResult> {
    return this.service.configResult()
  }

  @Remote
  async probe(): Promise<CoachProbeResult> {
    return this.service.probe()
  }
}

export async function apply(ctx: Context, config: ConfigShape): Promise<void> {
  const chainDir = dshHomePath(config.chainDir)
  const seedDir = fileURLToPath(new URL('../chains', import.meta.url))
  const registry = await ChainRegistry.load(chainDir, seedDir)

  const service = new CoachService(ctx.trainStore, registry, config as CoachConfig, {
    llm: () => {
      const providers = ctx.llm.listProviders()
      if (!providers.some((provider) => provider.id === config.provider)) return null
      const runtime = ctx.llm as unknown as LlmRuntimeLike
      return new DshLlmClient(runtime, { provider: config.provider, model: config.model }, config.requestTimeoutMs)
    },
  })

  new CoachRemote(ctx, service)
}
