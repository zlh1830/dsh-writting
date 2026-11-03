import { readFile } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import {
  countWords,
  hashText,
  TrainError,
  type LlmClient,
  type Question,
  type QuestionSummary,
  type SaveAttemptResult,
  type TrainStore,
} from '@local/dsh-train-core'
import { parseQuestionMarkdown, toQuestionSummary } from './markdown.js'
import { extractPoints } from './extract.js'
import type { Config } from './config.js'

export interface ImportQuestionRequest {
  path?: string
  text?: string
  id?: string
  force?: boolean
}

export interface ImportQuestionResult {
  question: Question
  pointsMissing: boolean
  warnings: string[]
}

export interface QuestionBankServiceOptions {
  /** Built lazily so a missing provider never blocks the answer view. */
  llm: () => LlmClient
  sessionExists: (sessionId: string) => boolean
  maxPoints: number
}

/** Business logic behind both the model-visible tools and the client-facing Remote. */
export class QuestionBankService {
  constructor(
    private readonly store: TrainStore,
    private readonly config: Config,
    private readonly options: QuestionBankServiceOptions,
  ) {}

  async importQuestion(request: ImportQuestionRequest): Promise<ImportQuestionResult> {
    const raw = await this.readSource(request)
    const parsed = parseQuestionMarkdown(raw, request.id)
    let question = parsed.question
    if (request.id !== undefined) {
      question = { ...question, id: request.id }
      if (!/^[a-zA-Z0-9_-]+$/u.test(question.id)) throw new TrainError('INVALID_INPUT', `invalid question id "${question.id}"`)
    }
    const warnings = [...parsed.warnings]
    let pointsMissing = question.points.length === 0
    if (pointsMissing || request.force === true) {
      try {
        const points = await extractPoints(this.options.llm(), question, this.options.maxPoints)
        question = { ...question, points }
        pointsMissing = false
      } catch (error) {
        warnings.push(`采分点抽取失败：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    await this.store.writeQuestion(question)
    return { question, pointsMissing, warnings }
  }

  async listQuestions(): Promise<QuestionSummary[]> {
    const questions = await this.store.listQuestions()
    return questions.sort((left, right) => left.id.localeCompare(right.id))
  }

  async getQuestion(questionId: string): Promise<Question> {
    const question = await this.store.getQuestion(questionId)
    if (question === undefined) throw new TrainError('QUESTION_NOT_FOUND', `question "${questionId}" was not found`)
    return question
  }

  async saveAttempt(request: {
    sessionId: string
    questionId: string
    content: string
    elapsedMs: number
  }): Promise<SaveAttemptResult> {
    if (!this.options.sessionExists(request.sessionId)) {
      throw new TrainError('SESSION_NOT_FOUND', `session "${request.sessionId}" is not live`)
    }
    const question = await this.getQuestion(request.questionId)
    const content = request.content
    const wordCount = countWords(content)
    if (wordCount < 50) {
      throw new TrainError('EMPTY_ATTEMPT', `作答至少需要 50 字，当前 ${wordCount} 字`)
    }
    const now = Date.now()
    const attempt = await this.store.saveAttempt({
      question,
      sessionId: request.sessionId,
      content,
      wordCount,
      elapsedMs: Math.max(0, Math.trunc(request.elapsedMs)),
      contentHash: hashText(content),
      now,
    })
    return {
      attemptId: attempt.attemptId,
      attemptNo: attempt.attemptNo,
      wordCount: attempt.wordCount,
      contentHash: attempt.contentHash,
      submittedAt: attempt.submittedAt,
    }
  }

  async getHistory(questionId: string): Promise<Awaited<ReturnType<TrainStore['getHistory']>>> {
    await this.getQuestion(questionId)
    // The view renders a scrollable list; keep enough rows that earlier attempts
    // stay reachable instead of silently falling off the end.
    return this.store.getHistory(questionId, 20)
  }

  summaryOf(question: Question): string {
    const points = question.points
      .map((point) => `- ${point.id} ${point.label}${point.criteria.length === 0 ? '' : `（${point.criteria}）`}`)
      .join('\n')
    return [
      `题目 ${question.id}｜${question.type}｜${question.topic}｜字数上限 ${question.wordLimit}`,
      `材料：\n${question.material.trim()}`,
      `作答要求：\n${question.requirement.trim()}`,
      `采分点（${points.length === 0 ? 0 : question.points.length}）：\n${points || '- 暂无'}`,
    ].join('\n\n')
  }

  summaryRow(question: Question): string {
    return `${question.id}｜${question.type}｜${question.topic}｜${question.wordLimit} 字｜采分点 ${question.points.length}`
  }

  private async readSource(request: ImportQuestionRequest): Promise<string> {
    if (typeof request.text === 'string' && request.text.trim().length > 0) return request.text
    if (typeof request.path === 'string' && request.path.trim().length > 0) {
      const target = isAbsolute(request.path) ? request.path : resolve(process.cwd(), request.path)
      try {
        return await readFile(target, 'utf8')
      } catch (error) {
        throw new TrainError('INVALID_INPUT', `cannot read question file "${target}": ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    throw new TrainError('INVALID_INPUT', 'provide either `path` or `text` for the question source')
  }
}

export { toQuestionSummary }
