import { describe, expect, it } from 'vitest'
import {
  DEFAULT_WEIGHTS,
  normalizeJudgeResult,
  type Attempt,
  type Question,
} from '../src/index.js'

const question: Question = {
  id: 'q1',
  type: '信访回复',
  topic: '投诉办理',
  wordLimit: 600,
  material: '某镇居民甲反映道路问题。',
  requirement: '起草书面回复。',
  points: [
    { id: 'p1', label: '受理', criteria: '写明受理' },
    { id: 'p2', label: '核查', criteria: '写明核查' },
    { id: 'p3', label: '时限', criteria: '写明时限' },
  ],
}

const attempt: Attempt = {
  attemptId: 'att-1',
  questionId: 'q1',
  sessionId: 's1',
  roundId: 1,
  attemptNo: 1,
  content: '第一段第一句。第一段第二句。\n\n第二段第一句。第二段第二句。',
  wordCount: 24,
  elapsedMs: 60_000,
  contentHash: 'hash',
  submittedAt: 1,
}

function raw(overrides: Record<string, unknown> = {}) {
  return {
    dimensions: { coverage: 80, chain: 70, elements: 75, language: 85, material: 80 },
    points: [
      { id: 'p1', status: 'hit', anchor: '1:1' },
      { id: 'p2', status: 'partial', anchor: '2:1' },
      { id: 'p3', status: 'miss' },
    ],
    missingLinks: ['时限'],
    missingPoints: ['完成时限'],
    suggestions: [
      { anchor: '2:1', issueType: '缺环节', direction: '补写完成时限和责任人', evidence: '第二段第一句', impact: 'high' },
    ],
    emptyPhrases: [],
    formatIssues: [],
    resolved: [],
    ...overrides,
  }
}

describe('normalizeJudgeResult', () => {
  it('composes the score and keeps valid anchors', () => {
    const result = normalizeJudgeResult({
      attempt,
      question,
      raw: raw(),
      weights: DEFAULT_WEIGHTS,
      threshold: 90,
      thresholdState: 'calibrating',
      modelId: 'deepseek-flash',
      promptVersion: 'judge-v1',
      weightsVersion: 'weights-v1',
    })
    expect(result.score).toBe(68)
    expect(result.pass).toBe(false)
    expect(result.dims).toEqual({ coverage: 50, chain: 80, elements: 70, language: 100, material: 80 })
    expect(result.suggestions).toHaveLength(1)
    expect(result.suggestions[0]?.anchor).toBe('2:1')
    expect(result.reference).toBeNull()
    expect(result.points.map((point) => point.status)).toEqual(['hit', 'partial', 'miss'])
  })

  it('drops suggestions whose anchors cannot be located', () => {
    const result = normalizeJudgeResult({
      attempt,
      question,
      raw: raw({
        suggestions: [{ anchor: '9:9', issueType: '缺环节', direction: '补写时限', evidence: '不存在的依据' }],
      }),
      weights: DEFAULT_WEIGHTS,
      threshold: 90,
      thresholdState: 'calibrating',
      modelId: 'deepseek-flash',
      promptVersion: 'judge-v1',
      weightsVersion: 'weights-v1',
    })
    expect(result.suggestions).toHaveLength(0)
    expect(result.badAnchorCount).toBe(1)
    expect(result.guardFlags.join('')).toContain('无法定位')
  })

  it('rejects incomplete point matrices', () => {
    expect(() =>
      normalizeJudgeResult({
        attempt,
        question,
        raw: raw({ points: [{ id: 'p1', status: 'hit' }] }),
        weights: DEFAULT_WEIGHTS,
        threshold: 90,
        thresholdState: 'calibrating',
        modelId: 'deepseek-flash',
        promptVersion: 'judge-v1',
        weightsVersion: 'weights-v1',
      }),
    ).toThrow(/omitted point judgments/)
  })

  it('accepts a missing dimension block because dimensions are server-derived', () => {
    const result = normalizeJudgeResult({
      attempt,
      question,
      raw: raw({ dimensions: undefined }),
      weights: DEFAULT_WEIGHTS,
      threshold: 90,
      thresholdState: 'calibrating',
      modelId: 'deepseek-flash',
      promptVersion: 'judge-v1',
      weightsVersion: 'weights-v1',
    })
    expect(result.score).toBe(68)
  })

  it('ignores model-supplied dimension numbers and derives them from the matrix', () => {
    const result = normalizeJudgeResult({
      attempt,
      question,
      raw: raw({ dimensions: { coverage: 0.33, chain: 0.16, elements: 0.16, language: 0.08, material: 0.09 } }),
      weights: DEFAULT_WEIGHTS,
      threshold: 90,
      thresholdState: 'calibrating',
      modelId: 'deepseek-flash',
      promptVersion: 'judge-v1',
      weightsVersion: 'weights-v1',
    })
    expect(result.dims).toEqual({ coverage: 50, chain: 80, elements: 70, language: 100, material: 80 })
    expect(result.score).toBe(68)
  })

  it('guards rewrite-shaped directions and caps suggestions at five', () => {
    const long = '第一段第一句。第一段第二句。第二段第一句。'.repeat(5)
    const result = normalizeJudgeResult({
      attempt,
      question,
      raw: raw({
        suggestions: Array.from({ length: 7 }, (_, index) => ({
          anchor: '1:1',
          issueType: '语言',
          direction: index === 0 ? long : `补写要点${index}`,
          evidence: '第一段第一句',
          impact: 'high',
        })),
      }),
      weights: DEFAULT_WEIGHTS,
      threshold: 90,
      thresholdState: 'calibrating',
      modelId: 'deepseek-flash',
      promptVersion: 'judge-v1',
      weightsVersion: 'weights-v1',
    })
    expect(result.suggestions).toHaveLength(5)
    expect(result.suggestions[0]?.guard).toBe(true)
    expect(result.guardFlags.join('')).toContain('不提供整段成稿')
  })
})

