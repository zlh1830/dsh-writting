import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_JUDGE_CONFIG,
  newAttemptId,
  toAttemptSummary,
  type Attempt,
  type HistoryEntry,
  type JudgeConfig,
  type JudgeEngine,
  type JudgeResult,
  type LlmClient,
  type LlmCompleteInput,
  type LlmCompletion,
  type Question,
  type SaveAttemptInput,
  type TrainStore,
} from '@local/dsh-train-core'
import { JudgeService } from '../src/service.js'

const QUESTION: Question = {
  id: 'q1',
  type: '信访回复',
  topic: '投诉办理',
  wordLimit: 600,
  material: '某镇居民甲反映道路问题。',
  requirement: '起草书面回复。',
  points: [
    { id: 'p1', label: '受理登记', criteria: '写明受理' },
    { id: 'p2', label: '核查事实', criteria: '写明核查' },
    { id: 'p3', label: '完成时限', criteria: '写明时限' },
  ],
}

const CONTENT = '第一段第一句。\n\n第二段第一句。'

async function fixtureJudge(): Promise<string> {
  return readFile(resolve(process.cwd(), 'fixtures', 'judge', 'xinfang-001.json'), 'utf8')
}

class MemoryStore implements TrainStore {
  private readonly questions = new Map<string, Question>()
  private readonly attempts = new Map<string, Attempt>()
  private readonly judges = new Map<string, JudgeResult>()

  constructor(question: Question = QUESTION) {
    this.questions.set(question.id, question)
  }

  async listQuestions() {
    return [...this.questions.values()].map((question) => ({
      id: question.id,
      type: question.type,
      topic: question.topic,
      wordLimit: question.wordLimit,
      pointsCount: question.points.length,
    }))
  }

  async getQuestion(questionId: string) {
    return this.questions.get(questionId)
  }

  async writeQuestion(question: Question) {
    this.questions.set(question.id, question)
  }

  async nextAttemptNo(questionId: string) {
    return [...this.attempts.values()].filter((attempt) => attempt.questionId === questionId).length + 1
  }

  async saveAttempt(input: SaveAttemptInput) {
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
    this.attempts.set(attempt.attemptId, attempt)
    return attempt
  }

  async getAttempt(attemptId: string) {
    return this.attempts.get(attemptId)
  }

  async listAttempts(questionId: string, limit = 20) {
    return [...this.attempts.values()]
      .filter((attempt) => attempt.questionId === questionId)
      .sort((left, right) => right.submittedAt - left.submittedAt)
      .slice(0, limit)
  }

  async saveJudge(result: JudgeResult) {
    this.judges.set(result.attemptId, result)
  }

  async getJudge(attemptId: string) {
    return this.judges.get(attemptId)
  }

  async findRecentJudge(questionId: string, contentHash: string, withinMs: number) {
    const cutoff = Date.now() - withinMs
    return [...this.judges.values()]
      .filter((judge) => judge.questionId === questionId && judge.contentHash === contentHash && judge.createdAt >= cutoff)
      .sort((left, right) => right.createdAt - left.createdAt)[0]
  }

  async getHistory(questionId: string, limit = 5): Promise<HistoryEntry[]> {
    const attempts = await this.listAttempts(questionId, limit)
    return attempts.map((attempt) => ({ attempt: toAttemptSummary(attempt), judge: this.judges.get(attempt.attemptId) ?? null }))
  }
}

class FakeLlm implements LlmClient {
  calls = 0
  inputs: LlmCompleteInput[] = []
  constructor(private readonly outputs: string[]) {}
  async complete(input: LlmCompleteInput): Promise<LlmCompletion> {
    this.inputs.push(input)
    const text = this.outputs[this.calls] ?? this.outputs[this.outputs.length - 1] ?? ''
    this.calls += 1
    return { text, usage: { input: 1200, output: 300, total: 1500 }, finish: 'stop', truncated: false }
  }
}

async function setup(outputs: string[], config: JudgeConfig = DEFAULT_JUDGE_CONFIG) {
  const store = new MemoryStore()
  const llm = new FakeLlm(outputs)
  const engines: JudgeEngine[] = []
  const service = new JudgeService(store, config, {
    llm: (engine) => {
      engines.push(engine)
      return llm
    },
  })
  const attempt = await store.saveAttempt({
    question: QUESTION,
    sessionId: 's1',
    content: CONTENT,
    wordCount: CONTENT.length,
    elapsedMs: 60_000,
    contentHash: 'hash-1',
    now: Date.now(),
  })
  return { store, llm, service, attempt, engines }
}

describe('JudgeService', () => {
  it('judges once, composes the score, and records token usage', async () => {
    const { service, llm, attempt } = await setup([await fixtureJudge()])
    const result = await service.judge(attempt.attemptId)
    expect(result.score).toBe(61)
    expect(result.pass).toBe(false)
    expect(result.suggestions).toHaveLength(2)
    expect(result.reference).toBeNull()
    expect(result.tokenUsage).toEqual({ input: 1200, output: 300, total: 1500 })
    expect(result.contentHash).toBe('hash-1')
    expect(llm.calls).toBe(1)
    expect(JSON.stringify(result)).not.toContain('fullRevision')
  })

  it('returns the persisted result without a second model call', async () => {
    const { service, llm, attempt } = await setup([await fixtureJudge()])
    const first = await service.judge(attempt.attemptId)
    const second = await service.judge(attempt.attemptId)
    expect(second).toEqual(first)
    expect(llm.calls).toBe(1)
  })

  it('retries once when the first output is not JSON', async () => {
    const { service, llm, attempt } = await setup(['not json', await fixtureJudge()])
    const result = await service.judge(attempt.attemptId)
    expect(result.score).toBe(61)
    expect(llm.calls).toBe(2)
  })

  it('retries once when point judgments are incomplete', async () => {
    const incomplete = JSON.stringify({
      dimensions: { coverage: 70, chain: 70, elements: 70, language: 70, material: 70 },
      points: [{ id: 'p1', status: 'hit' }],
    })
    const { service, llm, attempt } = await setup([incomplete, await fixtureJudge()])
    const result = await service.judge(attempt.attemptId)
    expect(result.points).toHaveLength(3)
    expect(llm.calls).toBe(2)
  })

  it('clones a recent judgment for an identical resubmission', async () => {
    const { store, service, llm, attempt } = await setup([await fixtureJudge()])
    const first = await service.judge(attempt.attemptId)
    const resubmitted = await store.saveAttempt({
      question: QUESTION,
      sessionId: 's1',
      content: CONTENT,
      wordCount: CONTENT.length,
      elapsedMs: 10_000,
      contentHash: 'hash-1',
      now: Date.now(),
    })
    const second = await service.judge(resubmitted.attemptId)
    expect(second.score).toBe(first.score)
    expect(second.attemptId).toBe(resubmitted.attemptId)
    expect(llm.calls).toBe(1)
  })

  it('fails loudly after two unusable outputs', async () => {
    const { service, attempt } = await setup(['not json', 'still not json'])
    await expect(service.judge(attempt.attemptId)).rejects.toMatchObject({ code: 'JUDGE_FAILED' })
  })
})

describe('JudgeService engines', () => {
  const LOCAL: JudgeConfig = { ...DEFAULT_JUDGE_CONFIG, localModel: 'qwen3.8-flash-next-iq2_xs' }

  it('uses the local engine when requested and records engine, model and budget', async () => {
    const { service, engines, llm, attempt } = await setup([await fixtureJudge()], LOCAL)
    const result = await service.judge(attempt.attemptId, { engine: 'local' })
    expect(engines).toEqual(['local'])
    expect(result.engine).toBe('local')
    expect(result.modelId).toBe('qwen3.8-flash-next-iq2_xs')
    expect(llm.inputs[0]?.system).toContain('points 必须正好包含这些 id')
    expect(llm.inputs[0]?.system).toContain('p1')
    expect(llm.inputs[0]?.maxTokens).toBe(LOCAL.localMaxOutputTokens)
  })

  it('keeps the cloud prompt and budget on the cloud engine', async () => {
    const { service, engines, llm, attempt } = await setup([await fixtureJudge()], LOCAL)
    const result = await service.judge(attempt.attemptId)
    expect(engines).toEqual(['cloud'])
    expect(result.engine).toBe('cloud')
    expect(result.modelId).toBe(DEFAULT_JUDGE_CONFIG.model)
    expect(llm.inputs[0]?.maxTokens).toBe(DEFAULT_JUDGE_CONFIG.maxOutputTokens)
    expect(llm.inputs[0]?.system).not.toContain('points 必须正好包含这些 id')
  })

  it('honours the configured default engine when the request names none', async () => {
    const { service, engines, attempt } = await setup([await fixtureJudge()], { ...LOCAL, engine: 'local' })
    const result = await service.judge(attempt.attemptId)
    expect(engines).toEqual(['local'])
    expect(result.engine).toBe('local')
  })

  it('re-judges when the requested engine differs from the stored scorecard', async () => {
    const { service, engines, llm, attempt } = await setup([await fixtureJudge(), await fixtureJudge()], LOCAL)
    const cloud = await service.judge(attempt.attemptId, { engine: 'cloud' })
    const local = await service.judge(attempt.attemptId, { engine: 'local' })
    expect(cloud.engine).toBe('cloud')
    expect(local.engine).toBe('local')
    expect(engines).toEqual(['cloud', 'local'])
    expect(llm.calls).toBe(2)
  })

  it('force re-judges even when a scorecard exists', async () => {
    const { service, llm, attempt } = await setup([await fixtureJudge(), await fixtureJudge()])
    await service.judge(attempt.attemptId)
    await service.judge(attempt.attemptId, { force: true })
    expect(llm.calls).toBe(2)
  })

  it('reports a missing local provider as NO_LOCAL_JUDGE instead of grading on the cloud', async () => {
    const store = new MemoryStore()
    const service = new JudgeService(store, LOCAL, {
      llm: () => {
        throw new Error('本地审核 provider "train-local" 未挂载')
      },
    })
    const attempt = await store.saveAttempt({
      question: QUESTION,
      sessionId: 's1',
      content: CONTENT,
      wordCount: CONTENT.length,
      elapsedMs: 1_000,
      contentHash: 'hash-local',
      now: Date.now(),
    })
    await expect(service.judge(attempt.attemptId, { engine: 'local' })).rejects.toMatchObject({ code: 'NO_LOCAL_JUDGE' })
    expect(await store.getJudge(attempt.attemptId)).toBeUndefined()
  })
})

