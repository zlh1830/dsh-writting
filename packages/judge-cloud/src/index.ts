import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_JUDGE_CONFIG,
  DshLlmClient,
  resolveRoute,
  TrainError,
  type JudgeConfig,
  type JudgeConfigResult,
  type JudgeEngine,
  type JudgeRequest,
  type JudgeResult,
  type LlmClient,
  type LlmRuntimeLike,
} from '@local/dsh-train-core'
import { Config, type Config as ConfigShape } from './config.js'
import { JudgeService, normalizeEngine } from './service.js'

export { Config }
export const name = 'train-judge-cloud'
export const inject = ['tools', 'llm', 'trainStore']

class JudgeRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly service: JudgeService,
    private readonly readConfig: () => JudgeConfigResult,
  ) {
    super(ctx, 'trainJudge', { namespace: 'train' })
  }

  @Remote
  async judge(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResult> {
    return this.service.judge(request.attemptId, {
      ...(request.engine === undefined ? {} : { engine: request.engine }),
      ...(request.force === undefined ? {} : { force: request.force }),
      signal,
    })
  }

  @Remote('judgeConfig')
  async config(): Promise<JudgeConfigResult> {
    return this.readConfig()
  }
}

export function apply(ctx: Context, config: ConfigShape): void {
  const judgeConfig: JudgeConfig = {
    ...DEFAULT_JUDGE_CONFIG,
    ...config,
    engine: normalizeEngine(config.engine),
    thresholdState: config.thresholdState === 'calibrated' ? 'calibrated' : 'calibrating',
    weights: { ...DEFAULT_JUDGE_CONFIG.weights, ...config.weights },
  }
  const localModel = judgeConfig.localModel.length > 0 ? judgeConfig.localModel : judgeConfig.model
  const runtime = ctx.llm as unknown as LlmRuntimeLike

  const readConfig = (): JudgeConfigResult => ({
    engine: judgeConfig.engine,
    provider: judgeConfig.provider,
    model: judgeConfig.model,
    localProvider: judgeConfig.localProvider,
    localModel,
    localAvailable: hasProvider(ctx, judgeConfig.localProvider),
  })

  const service = new JudgeService(ctx.trainStore, judgeConfig, {
    llm: (engine: JudgeEngine): LlmClient =>
      engine === 'local'
        ? localClient(ctx, runtime, judgeConfig.localProvider, localModel, judgeConfig.localRequestTimeoutMs)
        : cloudClient(runtime, judgeConfig),
  })

  ctx.tools.register(
    defineTool({
      name: 'train_judge_attempt',
      description:
        'Judge one saved attempt in a single pass. Returns the score, dimensions, scoring-point matrix, missing links/points, and anchored suggestions. Never returns a full rewrite or pasteable paragraph.',
      parameters: {
        attemptId: { type: 'string', required: true, description: 'Attempt id returned by train.saveAttempt' },
        engine: {
          type: 'string',
          description: 'Judge engine: "cloud" (default) or "local" (configured local model, offline, experimental)',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            score: { type: 'number', required: true },
            pass: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args, exec) {
        const result = await service.judge(args.attemptId, {
          ...(args.engine === 'local' ? { engine: 'local' as const } : {}),
          signal: exec.signal,
        })
        return {
          summary: service.summary(result),
          score: result.score,
          pass: result.pass,
        }
      },
    }),
  )

  new JudgeRemote(ctx, service, readConfig)
}

function hasProvider(ctx: Context, id: string): boolean {
  try {
    return ctx.llm.listProviders().some((provider) => provider.id === id)
  } catch {
    return false
  }
}

/** Calibrated cloud route; keeps the documented DeepSeek fallback when the preferred route is absent. */
function cloudClient(runtime: LlmRuntimeLike, config: JudgeConfig): LlmClient {
  // Structured JSON extraction does not need a long reasoning budget; keeping
  // effort low avoids burning the whole maxTokens allowance before any text.
  return new DshLlmClient(runtime, resolveRoute(runtime, { provider: config.provider, model: config.model }), config.requestTimeoutMs, 'low')
}

/**
 * Local route. It is deliberately not a fallback and never resolves to a cloud
 * provider: an offline machine must fail with a visible reason instead of
 * silently grading on the cloud model. Thinking stays off because the provider
 * profile sets `chat_template_kwargs.enable_thinking=false`, and no reasoning
 * effort is requested here.
 */
function localClient(ctx: Context, runtime: LlmRuntimeLike, provider: string, model: string, timeoutMs: number): LlmClient {
  if (!hasProvider(ctx, provider)) {
    throw new TrainError('NO_LOCAL_JUDGE', `本地审核 provider "${provider}" 未挂载；请在 DSH「设置 → 模型」配置后重启`)
  }
  return new DshLlmClient(runtime, { provider, model }, timeoutMs)
}
