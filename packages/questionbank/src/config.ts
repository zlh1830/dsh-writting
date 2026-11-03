import Schema from '@deepseek-ai/schemastery'

export interface Config {
  /** Directory under DSH_HOME that stores questions; default `train`. */
  dataDir: string
  /** Provider route used only for point extraction. */
  provider: string
  /** Model used only for point extraction. */
  model: string
  /** Maximum number of points kept per question. */
  maxPoints: number
  /** Extraction request timeout. */
  requestTimeoutMs: number
}

export const Config: Schema<Config> = Schema.object({
  dataDir: Schema.string().default('train'),
  provider: Schema.string().default('deepseek-account'),
  model: Schema.string().default('deepseek-flash'),
  maxPoints: Schema.natural().min(1).max(20).default(10),
  requestTimeoutMs: Schema.natural().min(5_000).max(120_000).default(30_000),
})
