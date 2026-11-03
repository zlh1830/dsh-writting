import { z } from 'zod'
import type { Attempt, JudgeResult, JudgeWeights, PointJudgment, Question, Suggestion } from './types.js'
import { composeScore } from './scoring.js'
import { resolveAnchor, shortenDirection, similarity } from './text.js'

export type JudgeProtocolCode = 'schema-invalid' | 'points-incomplete' | 'bad-output'

/** Raised when the model response cannot be normalized into the declared contract. */
export class JudgeProtocolError extends Error {
  override readonly name = 'JudgeProtocolError'
  constructor(
    readonly code: JudgeProtocolCode,
    message: string,
  ) {
    super(message)
  }
}

const RawPointSchema = z.object({
  id: z.string().optional(),
  status: z.string(),
  anchor: z.string().optional(),
  note: z.string().optional(),
})

const RawSuggestionSchema = z.object({
  anchor: z.string().optional(),
  issueType: z.string().optional(),
  direction: z.string(),
  evidence: z.string().optional(),
  impact: z.string().optional(),
})

const RawEmptyPhraseSchema = z.object({
  anchor: z.string().optional(),
  text: z.string(),
  missing: z.array(z.string()).optional(),
})

const RawResolvedSchema = z.object({
  id: z.string(),
  status: z.string(),
})

const RawJudgeSchema = z.object({
  dimensions: z.object({
    coverage: z.number(),
    chain: z.number(),
    elements: z.number(),
    language: z.number(),
    material: z.number(),
  }),
  points: z.array(RawPointSchema).optional(),
  missingLinks: z.array(z.string()).optional(),
  missingPoints: z.array(z.string()).optional(),
  suggestions: z.array(RawSuggestionSchema).optional(),
  emptyPhrases: z.array(RawEmptyPhraseSchema).optional(),
  formatIssues: z.array(z.string()).optional(),
  resolved: z.array(RawResolvedSchema).optional(),
  reference: z.string().nullable().optional(),
})

export interface NormalizeJudgeInput {
  attempt: Attempt
  question: Question
  raw: unknown
  weights: JudgeWeights
  threshold: number
  thresholdState: 'calibrating' | 'calibrated'
  modelId: string
  promptVersion: string
  weightsVersion: string
}

export interface GuardedSuggestions {
  suggestions: Suggestion[]
  flags: string[]
}

/** Validate the model response and attach server-composed score, anchors, and guards. */
export function normalizeJudgeResult(input: NormalizeJudgeInput): JudgeResult {
  const parsed = RawJudgeSchema.safeParse(input.raw)
  if (!parsed.success) {
    throw new JudgeProtocolError('schema-invalid', `model output failed the judge contract: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`)
  }
  const raw = parsed.data
  const content = input.attempt.content

  const rawPoints = new Map<string, z.infer<typeof RawPointSchema>>()
  for (const point of raw.points ?? []) {
    if (point.id !== undefined) rawPoints.set(point.id, point)
  }
  const missingPointIds = input.question.points.filter((point) => !rawPoints.has(point.id)).map((point) => point.id)
  if (missingPointIds.length > 0) {
    throw new JudgeProtocolError('points-incomplete', `model output omitted point judgments: ${missingPointIds.join(', ')}`)
  }

  const points: PointJudgment[] = input.question.points.map((point) => {
    const judgment = rawPoints.get(point.id)!
    const anchor = resolveAnchor(content, judgment.anchor, undefined)
    return {
      id: point.id,
      status: normalizePointStatus(judgment.status),
      ...(anchor === null ? {} : { anchor }),
      ...(judgment.note === undefined ? {} : { note: judgment.note }),
    }
  })

  let badAnchorCount = 0
  const normalizedSuggestions: Suggestion[] = []
  for (const suggestion of raw.suggestions ?? []) {
    const direction = suggestion.direction.trim()
    if (direction.length === 0) continue
    const anchor = resolveAnchor(content, suggestion.anchor, suggestion.evidence)
    if (anchor === null) {
      badAnchorCount += 1
      continue
    }
    normalizedSuggestions.push({
      id: `R${normalizedSuggestions.length + 1}`,
      anchor,
      issueType: normalizeIssueType(suggestion.issueType),
      direction,
      evidence: (suggestion.evidence ?? '').trim(),
      impact: normalizeImpact(suggestion.impact),
    })
  }
  const guarded = guardSuggestions(normalizedSuggestions, content)

  const emptyPhrases = (raw.emptyPhrases ?? []).flatMap((phrase) => {
    const anchor = resolveAnchor(content, phrase.anchor, phrase.text)
    if (anchor === null) return []
    return [{ anchor, text: phrase.text.trim(), missing: phrase.missing ?? [] }]
  })

  const score = composeScore(raw.dimensions, input.weights, {
    threshold: input.threshold,
    thresholdState: input.thresholdState,
  })

  const guardFlags = [...guarded.flags]
  if (badAnchorCount > 0) guardFlags.push(`已丢弃 ${badAnchorCount} 条无法定位的建议`)
  if (score.cappedByBlocker) guardFlags.push('格式阻断项使总分封顶')

  return {
    attemptId: input.attempt.attemptId,
    questionId: input.question.id,
    score: score.total,
    pass: score.pass,
    thresholdState: input.thresholdState,
    dims: raw.dimensions,
    points,
    missingLinks: uniqueStrings(raw.missingLinks ?? []),
    missingPoints: uniqueStrings(raw.missingPoints ?? []),
    suggestions: guarded.suggestions,
    emptyPhrases,
    formatIssues: uniqueStrings(raw.formatIssues ?? []),
    resolved: (raw.resolved ?? []).map((item) => ({
      id: item.id,
      status: item.status === 'solved' ? ('solved' as const) : ('unsolved' as const),
    })),
    reference: null,
    guardFlags,
    tokenUsage: { input: 0, output: 0 },
    modelId: input.modelId,
    promptVersion: input.promptVersion,
    weightsVersion: input.weightsVersion,
    contentHash: input.attempt.contentHash,
    createdAt: Date.now(),
    unstable: false,
    badAnchorCount,
  }
}

/** Keep at most five actionable suggestions, trimming rewrite-shaped directions. */
export function guardSuggestions(suggestions: Suggestion[], original: string): GuardedSuggestions {
  const rank = { high: 0, mid: 1, low: 2 } as const
  const sorted = [...suggestions].sort((left, right) => rank[left.impact] - rank[right.impact]).slice(0, 5)
  const flags: string[] = []
  const kept: Suggestion[] = []
  for (const suggestion of sorted) {
    const length = Array.from(suggestion.direction).length
    const tooLong = length > 80
    const looksLikeRewrite = length > 30 && similarity(suggestion.direction, original) > 0.8
    const direction = tooLong || looksLikeRewrite ? shortenDirection(suggestion.direction) : suggestion.direction
    if (direction.length === 0) continue
    if (tooLong || looksLikeRewrite) {
      flags.push('已按训练规则收敛建议，不提供整段成稿')
      kept.push({ ...suggestion, direction, guard: true })
    } else {
      kept.push({ ...suggestion, direction })
    }
  }
  return { suggestions: kept, flags: uniqueStrings(flags) }
}

export function normalizePointStatus(value: string): PointJudgment['status'] {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'hit' || normalized === '命中' || normalized === 'covered') return 'hit'
  if (normalized === 'partial' || normalized === '部分' || normalized === '部分命中') return 'partial'
  return 'miss'
}

export function normalizeIssueType(value: string | undefined): string {
  const raw = (value ?? '').trim()
  const mapping: Record<string, string> = {
    'missing-link': '缺环节',
    'missing-point': '缺材料点',
    coverage: '缺材料点',
    empty: '空话',
    'empty-phrase': '空话',
    length: '超字数',
    format: '格式',
    language: '语言',
    structure: '结构',
  }
  const mapped = mapping[raw.toLowerCase()]
  if (mapped !== undefined) return mapped
  const allowed = new Set(['缺环节', '缺材料点', '空话', '超字数', '格式', '语言', '结构', '其他'])
  return allowed.has(raw) ? raw : '其他'
}

export function normalizeImpact(value: string | undefined): Suggestion['impact'] {
  const raw = (value ?? '').trim().toLowerCase()
  if (raw === 'high' || raw === '高') return 'high'
  if (raw === 'low' || raw === '低') return 'low'
  return 'mid'
}

export function uniqueStrings(values: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const normalized = value.trim()
    if (normalized.length === 0 || seen.has(normalized)) continue
    seen.add(normalized)
    out.push(normalized)
  }
  return out
}

/** Compact, model-facing summary of a judge result. */
export function formatJudgeSummary(result: JudgeResult): string {
  const dims = result.dims
  const hits = result.points.filter((point) => point.status === 'hit').length
  const partial = result.points.filter((point) => point.status === 'partial').length
  const lines = [
    `总分 ${result.score}/100（${result.pass ? '达标' : '未达标'}；阈值状态 ${result.thresholdState}）`,
    `五维：覆盖 ${dims.coverage}｜链条 ${dims.chain}｜要素 ${dims.elements}｜语言 ${dims.language}｜材料 ${dims.material}`,
    `采分点：命中 ${hits}，部分 ${partial}，共 ${result.points.length}`,
  ]
  if (result.missingLinks.length > 0) lines.push(`缺失环节：${result.missingLinks.join('、')}`)
  if (result.missingPoints.length > 0) lines.push(`缺失材料点：${result.missingPoints.join('、')}`)
  if (result.suggestions.length > 0) {
    lines.push('改进方向：')
    for (const suggestion of result.suggestions.slice(0, 3)) {
      lines.push(`- [${suggestion.anchor}] ${suggestion.issueType}：${suggestion.direction}`)
    }
  }
  if (result.guardFlags.length > 0) lines.push(`守卫：${result.guardFlags.join('；')}`)
  return lines.join('\n')
}
