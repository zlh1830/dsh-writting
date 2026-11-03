import {
  formatJudgeSummary,
  JudgeProtocolError,
  normalizeJudgeResult,
  parseJsonLoose,
  TrainError,
  type Attempt,
  type JudgeConfig,
  type JudgeResult,
  type LlmClient,
  type Question,
  type TrainStore,
} from '@local/dsh-train-core'
import { buildJudgePayload, JUDGE_SYSTEM_PROMPT } from './prompt.js'

export interface JudgeServiceOptions {
  /** Built lazily so a missing provider surfaces as a normal judge failure, not plugin activation failure. */
  llm: () => LlmClient
  now?: () => number
}

export interface PreviousJudge {
  score: number
  unresolved: string[]
}

/** Single-pass judge: one model call per attempt, server-composed score, persisted scorecard. */
export class JudgeService {
  constructor(
    private readonly store: TrainStore,
    private readonly config: JudgeConfig,
    private readonly options: JudgeServiceOptions,
  ) {}

  async judge(attemptId: string, signal?: AbortSignal): Promise<JudgeResult> {
    const existing = await this.store.getJudge(attemptId)
    if (existing !== undefined) return existing

    const attempt = await this.store.getAttempt(attemptId)
    if (attempt === undefined) throw new TrainError('ATTEMPT_NOT_FOUND', `attempt "${attemptId}" was not found`)
    const question = await this.store.getQuestion(attempt.questionId)
    if (question === undefined) throw new TrainError('QUESTION_NOT_FOUND', `question "${attempt.questionId}" was not found`)

    const recent = await this.store.findRecentJudge(question.id, attempt.contentHash, 60_000)
    if (recent !== undefined) {
      const cached: JudgeResult = {
        ...recent,
        attemptId,
        createdAt: (this.options.now ?? Date.now)(),
        unstable: false,
        guardFlags: recent.guardFlags.filter((flag) => flag !== '本次评分波动较大'),
      }
      await this.store.saveJudge(cached)
      return cached
    }

    const previous = await this.previousJudge(question, attempt)
    const payload = buildJudgePayload(question, attempt, this.config, previous)
    let client: LlmClient
    try {
      client = this.options.llm()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      throw new TrainError('NO_PROVIDER', message)
    }

    let lastError: unknown
    for (let pass = 0; pass < 2; pass += 1) {
      try {
        const completion = await client.complete({
          system: JUDGE_SYSTEM_PROMPT,
          user: JSON.stringify(payload),
          maxTokens: this.config.maxOutputTokens,
          ...(signal === undefined ? {} : { signal }),
        })
        if (completion.truncated) {
          throw new JudgeProtocolError('bad-output', 'model output was truncated by max tokens')
        }
        let raw: unknown
        try {
          raw = parseJsonLoose(completion.text)
        } catch (error) {
          throw new JudgeProtocolError('bad-output', `model output was not JSON: ${error instanceof Error ? error.message : String(error)}`)
        }
        const result = normalizeJudgeResult({
          attempt,
          question,
          raw,
          weights: this.config.weights,
          threshold: this.config.passThreshold,
          thresholdState: this.config.thresholdState,
          modelId: this.config.model,
          promptVersion: 'judge-v1',
          weightsVersion: 'weights-v1',
        })
        result.tokenUsage = completion.usage
        if (previous !== null && Math.abs(result.score - previous.score) > 5) {
          result.unstable = true
          result.guardFlags.push('本次评分波动较大')
        }
        await this.store.saveJudge(result)
        return result
      } catch (error) {
        lastError = error
        if (!isRetryable(error)) break
      }
    }

    const message = lastError instanceof Error ? lastError.message : String(lastError)
    throw new TrainError('JUDGE_FAILED', `判分失败：${message}`)
  }

  /** Compact text for the model-facing tool result. */
  summary(result: JudgeResult): string {
    return formatJudgeSummary(result)
  }

  private async previousJudge(question: Question, current: Attempt): Promise<PreviousJudge | null> {
    const attempts = await this.store.listAttempts(question.id, 20)
    for (const attempt of attempts) {
      if (attempt.attemptId === current.attemptId || attempt.submittedAt > current.submittedAt) continue
      const judge = await this.store.getJudge(attempt.attemptId)
      if (judge === undefined) continue
      const unresolved = judge.suggestions
        .filter((suggestion) => !judge.resolved.some((entry) => entry.id === suggestion.id && entry.status === 'solved'))
        .map((suggestion) => suggestion.id)
      return { score: judge.score, unresolved }
    }
    return null
  }
}

function isRetryable(error: unknown): boolean {
  if (error instanceof JudgeProtocolError) return error.code === 'bad-output' || error.code === 'schema-invalid' || error.code === 'points-incomplete'
  return false
}
