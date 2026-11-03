import type {} from '@deepseek-ai/cordis'
import type { Attempt, HistoryEntry, JudgeResult, Question, QuestionSummary } from './types.js'

/** Host-side persistence and query surface shared by the question bank and the judge. */
export interface TrainStore {
  listQuestions(): Promise<QuestionSummary[]>
  getQuestion(questionId: string): Promise<Question | undefined>
  writeQuestion(question: Question): Promise<void>
  nextAttemptNo(questionId: string): Promise<number>
  saveAttempt(input: SaveAttemptInput): Promise<Attempt>
  getAttempt(attemptId: string): Promise<Attempt | undefined>
  listAttempts(questionId: string, limit?: number): Promise<Attempt[]>
  saveJudge(result: JudgeResult): Promise<void>
  getJudge(attemptId: string): Promise<JudgeResult | undefined>
  findRecentJudge(questionId: string, contentHash: string, withinMs: number): Promise<JudgeResult | undefined>
  getHistory(questionId: string, limit?: number): Promise<HistoryEntry[]>
}

export interface SaveAttemptInput {
  question: Question
  sessionId: string
  content: string
  wordCount: number
  elapsedMs: number
  contentHash: string
  now: number
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by the question bank plugin; consumed by the judge plugin. */
    trainStore: TrainStore
  }
}

/** A question/attempt key safe for the storage-domain record-key grammar. */
export function newAttemptId(now = Date.now()): string {
  const suffix = Math.random().toString(36).slice(2, 8)
  return `att-${now.toString(36)}-${suffix}`
}

export function toAttemptSummary(attempt: Attempt): Omit<Attempt, 'content'> {
  const { content: _content, ...summary } = attempt
  return summary
}
