import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DEFAULT_JUDGE_CONFIG,
  DshLlmClient,
  resolveRoute,
  type JudgeConfig,
  type JudgeRequest,
  type JudgeResult,
  type LlmRuntimeLike,
} from '@local/dsh-train-core'
import { Config, type Config as ConfigShape } from './config.js'
import { JudgeService } from './service.js'

export { Config }
export const name = 'train-judge-cloud'
export const inject = ['tools', 'llm', 'trainStore']

class JudgeRemote extends TypertRemoteService {
  private readonly service: JudgeService

  constructor(ctx: Context, service: JudgeService) {
    super(ctx, 'trainJudge', { namespace: 'train' })
    this.service = service
  }

  @Remote
  async judge(request: JudgeRequest, signal: AbortSignal): Promise<JudgeResult> {
    return this.service.judge(request.attemptId, signal)
  }
}

export function apply(ctx: Context, config: ConfigShape): void {
  const judgeConfig: JudgeConfig = {
    ...DEFAULT_JUDGE_CONFIG,
    ...config,
    thresholdState: config.thresholdState === 'calibrated' ? 'calibrated' : 'calibrating',
    weights: { ...DEFAULT_JUDGE_CONFIG.weights, ...config.weights },
  }
  const service = new JudgeService(ctx.trainStore, judgeConfig, {
    llm: () => {
      const runtime = ctx.llm as unknown as LlmRuntimeLike
      return new DshLlmClient(runtime, resolveRoute(runtime, { provider: judgeConfig.provider, model: judgeConfig.model }), judgeConfig.requestTimeoutMs)
    },
  })

  ctx.tools.register(
    defineTool({
      name: 'train_judge_attempt',
      description:
        'Judge one saved attempt in a single pass. Returns the score, dimensions, scoring-point matrix, missing links/points, and anchored suggestions. Never returns a full rewrite or pasteable paragraph.',
      parameters: {
        attemptId: { type: 'string', required: true, description: 'Attempt id returned by train.saveAttempt' },
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
        const result = await service.judge(args.attemptId, exec.signal)
        return {
          summary: service.summary(result),
          score: result.score,
          pass: result.pass,
        }
      },
    }),
  )

  new JudgeRemote(ctx, service)
}
