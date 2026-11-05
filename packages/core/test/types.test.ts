import { describe, expect, it } from 'vitest'
import { DEFAULT_JUDGE_CONFIG, JudgeRequestSchema, JudgeResultSchema } from '../src/index.js'

const SCORECARD = {
  attemptId: 'att-1',
  questionId: 'q1',
  score: 61,
  pass: false,
  thresholdState: 'calibrating' as const,
  dims: { coverage: 60, chain: 80, elements: 85, language: 100, material: 80 },
  points: [],
  missingLinks: [],
  missingPoints: [],
  suggestions: [],
  emptyPhrases: [],
  formatIssues: [],
  resolved: [],
  reference: null,
  guardFlags: [],
  tokenUsage: { input: 1, output: 1 },
  modelId: 'deepseek-flash',
  promptVersion: 'judge-v1',
  weightsVersion: 'weights-v1',
  contentHash: 'hash-1',
  createdAt: 1,
  unstable: false,
  badAnchorCount: 0,
}

describe('judge engine contracts', () => {
  it('accepts an optional engine and force flag on the request', () => {
    expect(JudgeRequestSchema.parse({ attemptId: 'a1', engine: 'local', force: true })).toEqual({
      attemptId: 'a1',
      engine: 'local',
      force: true,
    })
    expect(JudgeRequestSchema.parse({ attemptId: 'a1' })).toEqual({ attemptId: 'a1' })
    expect(() => JudgeRequestSchema.parse({ attemptId: 'a1', engine: 'edge' })).toThrow()
    expect(() => JudgeRequestSchema.parse({ attemptId: 'a1', extra: 1 })).toThrow()
  })

  it('reads scorecards written before the engine split as cloud results', () => {
    expect(JudgeResultSchema.parse(SCORECARD).engine).toBe('cloud')
    expect(JudgeResultSchema.parse({ ...SCORECARD, engine: 'local' }).engine).toBe('local')
  })

  it('ships cloud as the default engine and a larger local output budget', () => {
    expect(DEFAULT_JUDGE_CONFIG.engine).toBe('cloud')
    expect(DEFAULT_JUDGE_CONFIG.localProvider).toBe('train-local')
    expect(DEFAULT_JUDGE_CONFIG.localMaxOutputTokens).toBeGreaterThan(DEFAULT_JUDGE_CONFIG.maxOutputTokens)
    expect(DEFAULT_JUDGE_CONFIG.localRequestTimeoutMs).toBeGreaterThan(DEFAULT_JUDGE_CONFIG.requestTimeoutMs)
  })
})
