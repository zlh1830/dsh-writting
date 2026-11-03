import Schema from '@deepseek-ai/schemastery'
import { DEFAULT_COACH_CONFIG, type CoachConfig } from '@local/dsh-train-core'

export type Config = CoachConfig

export const Config = Schema.object({
  chainDir: Schema.string().default(DEFAULT_COACH_CONFIG.chainDir),
  provider: Schema.string().default(DEFAULT_COACH_CONFIG.provider),
  model: Schema.string().default(DEFAULT_COACH_CONFIG.model),
  mode: Schema.string().default(DEFAULT_COACH_CONFIG.mode),
  idleDelayMs: Schema.number().min(500).max(30_000).default(DEFAULT_COACH_CONFIG.idleDelayMs),
  charThreshold: Schema.number().min(10).max(500).default(DEFAULT_COACH_CONFIG.charThreshold),
  minIntervalMs: Schema.number().min(200).max(30_000).default(DEFAULT_COACH_CONFIG.minIntervalMs),
  requestTimeoutMs: Schema.number().min(1_000).max(60_000).default(DEFAULT_COACH_CONFIG.requestTimeoutMs),
  maxParagraphChars: Schema.number().min(100).max(4_000).default(DEFAULT_COACH_CONFIG.maxParagraphChars),
  degradeAfterFailures: Schema.number().min(1).max(10).default(DEFAULT_COACH_CONFIG.degradeAfterFailures),
}) as unknown as Schema<Config>
