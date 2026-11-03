import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import {
  DshLlmClient,
  resolveRoute,
  type GetHistoryRequest,
  type GetQuestionRequest,
  type HistoryResult,
  type ListQuestionsResult,
  type LlmRuntimeLike,
  type Question,
  type SaveAttemptRequest,
  type SaveAttemptResult,
} from '@local/dsh-train-core'
import { Config, type Config as ConfigShape } from './config.js'
import { TrainDataStore, TrainDomain } from './domain.js'
import { QuestionBankService } from './service.js'

export { Config }
export const name = 'train-questionbank'
export const inject = ['storageDomain', 'tools', 'llm', 'sessions']

/** Client-facing Remote service; SRC fallback binds it to the `train` namespace. */
class QuestionBankRemote extends TypertRemoteService {
  constructor(
    ctx: Context,
    private readonly service: QuestionBankService,
  ) {
    super(ctx, 'trainQuestionBank', { namespace: 'train' })
  }

  @Remote
  async listQuestions(): Promise<ListQuestionsResult> {
    return { questions: await this.service.listQuestions() }
  }

  @Remote
  async getQuestion(request: GetQuestionRequest): Promise<Question> {
    return this.service.getQuestion(request.questionId)
  }

  @Remote
  async saveAttempt(request: SaveAttemptRequest): Promise<SaveAttemptResult> {
    return this.service.saveAttempt(request)
  }

  @Remote
  async getHistory(request: GetHistoryRequest): Promise<HistoryResult> {
    return { entries: await this.service.getHistory(request.questionId) }
  }
}

export async function apply(ctx: Context, config: ConfigShape): Promise<void> {
  const questionDir = join(dshHomePath(config.dataDir), 'questions')
  const domain = await ctx.storageDomain.open(TrainDomain)
  const lifecycle = ctx as unknown as { effect(execute: () => () => void, label?: string): unknown }
  lifecycle.effect(() => () => {
    void domain.close()
  })

  const store = new TrainDataStore(domain, questionDir)
  await store.init()
  ctx.reflect.provide('trainStore', store)

  const service = new QuestionBankService(store, config, {
    llm: () => {
      const runtime = ctx.llm as unknown as LlmRuntimeLike
      return new DshLlmClient(runtime, resolveRoute(runtime, { provider: config.provider, model: config.model }), config.requestTimeoutMs)
    },
    sessionExists: (sessionId) => ctx.sessions.get(sessionId as never) !== undefined,
    maxPoints: config.maxPoints,
  })

  ctx.tools.register(
    defineTool({
      name: 'train_question_import',
      description:
        'Import one synthetic or user-authored question Markdown file into the training question bank. Extracts and caches its scoring points when missing; use `force` to re-extract.',
      parameters: {
        path: { type: 'string', description: 'Absolute or workspace-relative path to a question .md file' },
        text: { type: 'string', description: 'Complete question Markdown (frontmatter + material + requirement)' },
        id: { type: 'string', description: 'Optional stable question id; must match [a-zA-Z0-9_-]+' },
        force: { type: 'boolean', description: 'Re-extract scoring points even when cached points exist' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            questionId: { type: 'string', required: true },
            pointsCount: { type: 'number', required: true },
            pointsMissing: { type: 'boolean', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args) {
        const result = await service.importQuestion({
          ...(args.path === undefined ? {} : { path: args.path }),
          ...(args.text === undefined ? {} : { text: args.text }),
          ...(args.id === undefined ? {} : { id: args.id }),
          ...(args.force === undefined ? {} : { force: args.force }),
        })
        const lines = [
          `已导入 ${result.question.id}：${result.question.type}｜${result.question.topic}｜采分点 ${result.question.points.length}`,
          ...result.warnings.map((warning) => `注意：${warning}`),
        ]
        return {
          summary: lines.join('\n'),
          questionId: result.question.id,
          pointsCount: result.question.points.length,
          pointsMissing: result.pointsMissing,
        }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'train_question_list',
      description: 'List all imported training questions with type, topic, word limit, and cached point count.',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            count: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute() {
        const questions = await service.listQuestions()
        const summary =
          questions.length === 0
            ? '题库为空。使用 train_question_import 导入一道题。'
            : questions.map((question) => `${question.id}｜${question.type}｜${question.topic}｜${question.wordLimit} 字｜采分点 ${question.pointsCount}`).join('\n')
        return { summary, count: questions.length }
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'train_question_get',
      description: 'Read one question: material, requirement, cached scoring points, and word limit.',
      parameters: {
        questionId: { type: 'string', required: true, description: 'Question id' },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            summary: { type: 'string', required: true },
            questionId: { type: 'string', required: true },
            pointsCount: { type: 'number', required: true },
          },
        },
        render: (_args, value) => [{ type: 'text', text: value.summary }],
      },
      async execute(args) {
        const question = await service.getQuestion(args.questionId)
        return {
          summary: service.summaryOf(question),
          questionId: question.id,
          pointsCount: question.points.length,
        }
      },
    }),
  )

  new QuestionBankRemote(ctx, service)
}
