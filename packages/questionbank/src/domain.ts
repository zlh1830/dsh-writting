import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  AttemptSchema,
  FallbackSchema,
  JudgeResultSchema,
  newAttemptId,
  toAttemptSummary,
  type Attempt,
  type Fallback,
  type HistoryEntry,
  type JudgeResult,
  type Question,
  type QuestionSummary,
  type SaveAttemptInput,
  type TrainStore,
} from '@local/dsh-train-core'
import { defineDomain, domainTable, type Domain, type KvTable } from '@deepseek-ai/dsh-storage-domain'
import { parseQuestionMarkdown, serializeQuestionMarkdown, toQuestionSummary } from './markdown.js'

export const TrainDomain = defineDomain({
  name: 'dsh-train',
  version: 1,
  layout: 'per-record',
  tables: {
    attempts: domainTable<string, Attempt>(AttemptSchema),
    judges: domainTable<string, JudgeResult>(JudgeResultSchema),
    fallback: domainTable<string, Fallback>(FallbackSchema),
  },
})

export type TrainDomainSpec = typeof TrainDomain

/** Domain-backed store; one instance is provided as `ctx.trainStore`. */
export class TrainDataStore implements TrainStore {
  private readonly attempts: KvTable<string, Attempt>
  private readonly judges: KvTable<string, JudgeResult>

  private readonly questions = new Map<string, Question>()

  constructor(
    private readonly domain: Domain<TrainDomainSpec>,
    readonly questionDir: string,
  ) {
    this.attempts = domain.table('attempts')
    this.judges = domain.table('judges')
  }

  async init(): Promise<void> {
    await mkdir(this.questionDir, { recursive: true })
    await this.refresh()
  }

  /** Re-read the question directory; a broken file is skipped with a warning. */
  async refresh(): Promise<void> {
    const files = await readdir(this.questionDir, { withFileTypes: true })
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue
      const id = file.name.slice(0, -3)
      try {
        const raw = await readFile(join(this.questionDir, file.name), 'utf8')
        const { question } = parseQuestionMarkdown(raw, id)
        this.questions.set(question.id, question)
      } catch (error) {
        console.warn(`[dsh-train] skipping unreadable question ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  async listQuestions(): Promise<QuestionSummary[]> {
    return [...this.questions.values()].map(toQuestionSummary)
  }

  async getQuestion(questionId: string): Promise<Question | undefined> {
    const cached = this.questions.get(questionId)
    if (cached !== undefined) return cached
    try {
      const raw = await readFile(join(this.questionDir, `${questionId}.md`), 'utf8')
      const { question } = parseQuestionMarkdown(raw, questionId)
      this.questions.set(question.id, question)
      return question
    } catch {
      return undefined
    }
  }

  async writeQuestion(question: Question): Promise<void> {
    await mkdir(this.questionDir, { recursive: true })
    await writeFile(join(this.questionDir, `${question.id}.md`), serializeQuestionMarkdown(question), 'utf8')
    this.questions.set(question.id, question)
  }

  async nextAttemptNo(questionId: string): Promise<number> {
    let highest = 0
    for (const [, attempt] of this.attempts.entries()) {
      if (attempt.questionId === questionId && attempt.attemptNo > highest) highest = attempt.attemptNo
    }
    return highest + 1
  }

  async saveAttempt(input: SaveAttemptInput): Promise<Attempt> {
    const attemptNo = await this.nextAttemptNo(input.question.id)
    const attempt: Attempt = {
      attemptId: newAttemptId(input.now),
      questionId: input.question.id,
      sessionId: input.sessionId,
      roundId: attemptNo,
      attemptNo,
      content: input.content,
      wordCount: input.wordCount,
      elapsedMs: input.elapsedMs,
      contentHash: input.contentHash,
      submittedAt: input.now,
    }
    await this.attempts.put(attempt.attemptId, attempt)
    return attempt
  }

  async getAttempt(attemptId: string): Promise<Attempt | undefined> {
    return this.attempts.get(attemptId)
  }

  async listAttempts(questionId: string, limit = 20): Promise<Attempt[]> {
    const rows: Attempt[] = []
    for (const [, attempt] of this.attempts.entries()) {
      if (attempt.questionId === questionId) rows.push(attempt)
    }
    return rows.sort((left, right) => right.submittedAt - left.submittedAt).slice(0, limit)
  }

  async saveJudge(result: JudgeResult): Promise<void> {
    await this.judges.put(result.attemptId, result)
  }

  async getJudge(attemptId: string): Promise<JudgeResult | undefined> {
    return this.judges.get(attemptId)
  }

  async findRecentJudge(questionId: string, contentHash: string, withinMs: number): Promise<JudgeResult | undefined> {
    const cutoff = Date.now() - withinMs
    let latest: JudgeResult | undefined
    for (const [, judge] of this.judges.entries()) {
      if (judge.questionId !== questionId || judge.contentHash !== contentHash) continue
      if (judge.createdAt < cutoff) continue
      if (latest === undefined || judge.createdAt > latest.createdAt) latest = judge
    }
    return latest
  }

  async getHistory(questionId: string, limit = 5): Promise<HistoryEntry[]> {
    const attempts = await this.listAttempts(questionId, limit)
    const entries: HistoryEntry[] = []
    for (const attempt of attempts) {
      entries.push({
        attempt: toAttemptSummary(attempt),
        judge: (await this.getJudge(attempt.attemptId)) ?? null,
      })
    }
    return entries
  }

  async close(): Promise<void> {
    await this.domain.close()
  }
}
