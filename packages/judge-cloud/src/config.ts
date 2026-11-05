import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from '@local/dsh-train-core'

export type Config = JudgeConfig

export const Config = Schema.object({
  /** `cloud` (default) or `local`; the answer view can override it per submission. */
  engine: Schema.string().default(DEFAULT_JUDGE_CONFIG.engine),
  provider: Schema.string().default(DEFAULT_JUDGE_CONFIG.provider),
  model: Schema.string().default(DEFAULT_JUDGE_CONFIG.model),
  localProvider: Schema.string().default(DEFAULT_JUDGE_CONFIG.localProvider),
  /** Empty keeps the coach/route default model of that provider. */
  localModel: Schema.string().default(DEFAULT_JUDGE_CONFIG.localModel),
  localRequestTimeoutMs: Schema.number().min(5_000).max(180_000).default(DEFAULT_JUDGE_CONFIG.localRequestTimeoutMs),
  localMaxOutputTokens: Schema.number().min(200).max(8_000).default(DEFAULT_JUDGE_CONFIG.localMaxOutputTokens),
  passThreshold: Schema.number().min(1).max(100).default(DEFAULT_JUDGE_CONFIG.passThreshold),
  thresholdState: Schema.string().default(DEFAULT_JUDGE_CONFIG.thresholdState),
  requestTimeoutMs: Schema.number().min(5_000).max(180_000).default(DEFAULT_JUDGE_CONFIG.requestTimeoutMs),
  maxOutputTokens: Schema.number().min(200).max(8_000).default(DEFAULT_JUDGE_CONFIG.maxOutputTokens),
  weights: Schema.object({
    coverage: Schema.number().min(0).max(1).default(DEFAULT_JUDGE_CONFIG.weights.coverage),
    chain: Schema.number().min(0).max(1).default(DEFAULT_JUDGE_CONFIG.weights.chain),
    elements: Schema.number().min(0).max(1).default(DEFAULT_JUDGE_CONFIG.weights.elements),
    language: Schema.number().min(0).max(1).default(DEFAULT_JUDGE_CONFIG.weights.language),
    material: Schema.number().min(0).max(1).default(DEFAULT_JUDGE_CONFIG.weights.material),
  }).default(DEFAULT_JUDGE_CONFIG.weights),
}) as unknown as Schema<Config>
