import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_JUDGE_CONFIG, type JudgeConfig } from '@local/dsh-train-core'

export type Config = JudgeConfig

export const Config = Schema.object({
  provider: Schema.string().default(DEFAULT_JUDGE_CONFIG.provider),
  model: Schema.string().default(DEFAULT_JUDGE_CONFIG.model),
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

