import { mkdtemp, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_COACH_CONFIG,
  type ChainCard,
  type CoachConfig,
  type Question,
  type TrainStore,
} from '@local/dsh-train-core'
import { ChainRegistry, parseChainMarkdown } from '../src/chains.js'
import { CoachService } from '../src/service.js'

const CHAIN: ChainCard = {
  id: 'chain-test',
  name: '测试链',
  description: '',
  questionTypes: ['通知'],
  required: ['目的', '范围', '时限', '验收'],
  optional: ['附件'],
  anchors: {
    目的: ['为进一步'],
    范围: ['各单位'],
    时限: ['个工作日内'],
    验收: ['验收'],
    附件: ['附件'],
  },
}

const QUESTION: Question = {
  id: 'q1',
  type: '通知',
  topic: '专项检查',
  wordLimit: 500,
  material: '',
  requirement: '',
  chainType: 'chain-test',
  points: [],
}

class FakeStore implements TrainStore {
  async listQuestions() {
    return []
  }
  async getQuestion(id: string) {
    return id === QUESTION.id ? QUESTION : undefined
  }
  async writeQuestion() {}
  async nextAttemptNo() {
    return 1
  }
  async saveAttempt(): Promise<never> {
    throw new Error('not used')
  }
  async getAttempt() {
    return undefined
  }
  async listAttempts() {
    return []
  }
  async saveJudge() {}
  async getJudge() {
    return undefined
  }
  async findRecentJudge() {
    return undefined
  }
  async getHistory() {
    return []
  }
}

class FakeLlm {
  calls = 0
  constructor(private readonly outputs: Array<string | Error>) {}
  async complete() {
    const output = this.outputs[Math.min(this.calls, this.outputs.length - 1)]
    this.calls += 1
    if (output instanceof Error) throw output
    return { text: output ?? '', usage: { input: 10, output: 5 }, finish: 'stop', truncated: false }
  }
}

const CONFIG: CoachConfig = { ...DEFAULT_COACH_CONFIG, mode: 'auto', requestTimeoutMs: 500 }

function service(llm: (() => FakeLlm | null) | null) {
  return new CoachService(new FakeStore(), ChainRegistry.fromCards([CHAIN]), CONFIG, {
    llm: llm === null ? () => null : () => llm(),
  })
}

const scanRequest = (content: string) => ({
  sessionId: 's1',
  questionId: 'q1',
  content,
  paragraph: content,
  paragraphIndex: 1,
})

describe('chain registry', () => {
  it('parses frontmatter and copies seeds only into an empty directory', async () => {
    const dir = await mkdtemp(join(process.cwd(), '.tmp', 'coach-chain-'))
    try {
      const seedDir = resolve(process.cwd(), 'packages', 'coach-local', 'chains')
      const registry = await ChainRegistry.load(dir, seedDir)
      expect(registry.count).toBe(3)
      expect(registry.find({ type: '通知', chainType: 'chain-tongzhi' })?.id).toBe('chain-tongzhi')
      expect(registry.find({ type: '信访回复' })?.id).toBe('chain-xinfang')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('validates required links', () => {
    expect(() => parseChainMarkdown('---\nname: x\nrequired: []\n---\n', 'x')).toThrow(/required/)
  })
})

describe('CoachService rules', () => {
  it('returns the chain and an initial all-missing snapshot', async () => {
    const svc = service(null)
    const result = await svc.getChain({ sessionId: 's1', questionId: 'q1' })
    expect(result.chain?.id).toBe('chain-test')
    expect(result.snapshot?.coverage).toBe(0)
    expect(result.snapshot?.source).toBe('rules')
    expect(result.snapshot?.sessionId).toBe('s1')
    expect(result.providerAvailable).toBe(false)
  })

  it('upgrades coverage from full-text anchors without a provider', async () => {
    const svc = service(null)
    await svc.getChain({ sessionId: 's1', questionId: 'q1' })
    const snapshot = await svc.scan(scanRequest('为进一步加强检查，各单位于5个工作日内完成验收。'))
    expect(snapshot.coverage).toBe(100)
    expect(snapshot.states).toMatchObject({ 目的: 'covered', 范围: 'covered', 时限: 'covered', 验收: 'covered' })
    expect(snapshot.source).toBe('rules')
    expect(snapshot.failures).toBe(0)
  })

  it('full check marks absent links missing', async () => {
    const svc = service(null)
    await svc.getChain({ sessionId: 's1', questionId: 'q1' })
    const snapshot = await svc.check({ sessionId: 's1', questionId: 'q1', content: '为进一步加强检查。' })
    expect(snapshot.states).toMatchObject({ 目的: 'covered', 范围: 'missing', 时限: 'missing', 验收: 'missing' })
    expect(snapshot.coverage).toBe(25)
  })
})

describe('CoachService model and degradation', () => {
  it('uses the local model and merges its states', async () => {
    const fake = new FakeLlm(['{"covered":["目的"],"uncertain":["时限"],"missing":["范围","验收"]}'])
    const svc = service(() => fake)
    await svc.getChain({ sessionId: 's1', questionId: 'q1' })
    const snapshot = await svc.scan(scanRequest('随便写一段。'))
    expect(snapshot.source).toBe('model')
    expect(snapshot.states).toMatchObject({ 目的: 'covered', 时限: 'uncertain', 范围: 'missing', 验收: 'missing' })
    expect(snapshot.coverage).toBe(38)
    expect(fake.calls).toBe(1)
  })

  it('falls back to rules after a model failure and degrades after three failures', async () => {
    const fake = new FakeLlm([new Error('connect ECONNREFUSED')])
    const svc = service(() => fake)
    await svc.getChain({ sessionId: 's1', questionId: 'q1' })
    const first = await svc.scan(scanRequest('为进一步加强检查，各单位于5个工作日内完成验收。'))
    expect(first.source).toBe('degraded')
    expect(first.failures).toBe(1)
    expect(first.coverage).toBe(100)
    await svc.scan(scanRequest('为进一步加强检查，各单位于5个工作日内完成验收。'))
    const third = await svc.scan(scanRequest('为进一步加强检查，各单位于5个工作日内完成验收。'))
    expect(third.failures).toBe(3)
    const calls = fake.calls
    await svc.scan(scanRequest('为进一步加强检查，各单位于5个工作日内完成验收。'))
    expect(fake.calls).toBe(calls)
    expect(third.source).toBe('degraded')
  })

  it('discards a model response that flips three or more links', async () => {
    const fake = new FakeLlm([
      '{"covered":["目的","范围","时限"],"missing":["验收"]}',
      '{"covered":[],"missing":["目的","范围","时限","验收"]}',
    ])
    const svc = service(() => fake)
    await svc.getChain({ sessionId: 's1', questionId: 'q1' })
    const first = await svc.scan(scanRequest('随便写一段。'))
    expect(first.coverage).toBe(75)
    const second = await svc.scan(scanRequest('随便写一段。'))
    expect(second.discarded).toBe(true)
    expect(second.flipped).toBeGreaterThanOrEqual(3)
    expect(second.coverage).toBe(75)
  })

  it('probes the local route and reports no provider without falling back', async () => {
    const noProvider = await service(null).probe()
    expect(noProvider.ok).toBe(false)
    expect(noProvider.error).toContain('NO_PROVIDER')
    const fake = new FakeLlm(['OK'])
    const probe = await service(() => fake).probe()
    expect(probe.ok).toBe(true)
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it('resets the ephemeral snapshot', async () => {
    const svc = service(null)
    await svc.scan(scanRequest('为进一步加强检查，各单位于5个工作日内完成验收。'))
    expect((await svc.getChain({ sessionId: 's1', questionId: 'q1' })).snapshot?.coverage).toBe(100)
    await svc.reset({ sessionId: 's1', questionId: 'q1' })
    expect((await svc.getChain({ sessionId: 's1', questionId: 'q1' })).snapshot?.coverage).toBe(0)
  })
})
