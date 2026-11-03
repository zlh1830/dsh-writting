import { z } from 'zod'
import { splitParagraphs } from './text.js'
import type { Question } from './types.js'

/** One chain link's visible state. */
export const LinkStateSchema = z.enum(['covered', 'uncertain', 'missing'])
export type LinkState = z.infer<typeof LinkStateSchema>

/** A user-editable chain card. `required` drives coverage; `optional` is advisory. */
export const ChainCardSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/u, 'chain id must be [a-zA-Z0-9_-]+'),
  name: z.string().min(1),
  description: z.string().default(''),
  questionTypes: z.array(z.string()).default([]),
  required: z.array(z.string().min(1)).min(1),
  optional: z.array(z.string().min(1)).default([]),
  anchors: z.record(z.string(), z.array(z.string())).default({}),
})
export type ChainCard = z.infer<typeof ChainCardSchema>

export const CoachSourceSchema = z.enum(['rules', 'model', 'degraded'])
export type CoachSource = z.infer<typeof CoachSourceSchema>

/** Ephemeral Host-side snapshot; never persisted and never contains the draft. */
export const ChainSnapshotSchema = z.object({
  sessionId: z.string(),
  questionId: z.string(),
  chainId: z.string(),
  chainName: z.string(),
  required: z.array(z.string()),
  optional: z.array(z.string()),
  states: z.record(z.string(), LinkStateSchema),
  coverage: z.number().min(0).max(100),
  source: CoachSourceSchema,
  providerAvailable: z.boolean(),
  failures: z.number().int().nonnegative(),
  degradedReason: z.string().optional(),
  checkedAt: z.number().int(),
  paragraphIndex: z.number().int().nonnegative().optional(),
  latencyMs: z.number().int().nonnegative(),
  discarded: z.boolean(),
  flipped: z.number().int().nonnegative(),
})
export type ChainSnapshot = z.infer<typeof ChainSnapshotSchema>

export const GetChainRequestSchema = z.object({ sessionId: z.string().min(1), questionId: z.string().min(1) }).strict()
export type GetChainRequest = z.infer<typeof GetChainRequestSchema>

export const GetChainResultSchema = z.object({
  chain: ChainCardSchema.nullable(),
  snapshot: ChainSnapshotSchema.nullable(),
  providerAvailable: z.boolean(),
  mode: z.string(),
})
export type GetChainResult = z.infer<typeof GetChainResultSchema>

export const CoachScanRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    questionId: z.string().min(1),
    content: z.string(),
    paragraph: z.string(),
    paragraphIndex: z.number().int().nonnegative().default(0),
    forceModel: z.boolean().optional(),
  })
  .strict()
export type CoachScanRequest = z.infer<typeof CoachScanRequestSchema>

export const CoachCheckRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    questionId: z.string().min(1),
    content: z.string(),
    forceModel: z.boolean().optional(),
  })
  .strict()
export type CoachCheckRequest = z.infer<typeof CoachCheckRequestSchema>

export const CoachResetRequestSchema = z.object({ sessionId: z.string().min(1), questionId: z.string().min(1) }).strict()
export type CoachResetRequest = z.infer<typeof CoachResetRequestSchema>

export const CoachConfigResultSchema = z.object({
  provider: z.string(),
  model: z.string(),
  mode: z.string(),
  providerAvailable: z.boolean(),
  chainCount: z.number().int().nonnegative(),
})
export type CoachConfigResult = z.infer<typeof CoachConfigResultSchema>

export const CoachProbeResultSchema = z.object({
  ok: z.boolean(),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number().int().nonnegative(),
  error: z.string().optional(),
})
export type CoachProbeResult = z.infer<typeof CoachProbeResultSchema>

export interface CoachConfig {
  chainDir: string
  provider: string
  model: string
  mode: 'auto' | 'rules' | 'model'
  idleDelayMs: number
  charThreshold: number
  minIntervalMs: number
  requestTimeoutMs: number
  maxParagraphChars: number
  degradeAfterFailures: number
}

export const DEFAULT_COACH_CONFIG: CoachConfig = {
  chainDir: 'train/chains',
  provider: 'train-local',
  model: 'qwen2.5:3b',
  mode: 'auto',
  idleDelayMs: 3_000,
  charThreshold: 50,
  minIntervalMs: 2_000,
  requestTimeoutMs: 8_000,
  maxParagraphChars: 1_200,
  degradeAfterFailures: 3,
}

const LinkListsSchema = z.object({
  covered: z.array(z.unknown()).optional(),
  missing: z.array(z.unknown()).optional(),
  uncertain: z.array(z.unknown()).optional(),
})

export interface ParsedCoachStates {
  covered: string[]
  uncertain: string[]
  missing: string[]
}

/** Tolerant parse of a local model's link-recognition JSON. */
export function parseCoachJson(raw: string, chain: ChainCard): ParsedCoachStates | null {
  let json: unknown
  try {
    json = parseJsonObject(raw)
  } catch {
    return null
  }
  const parsed = LinkListsSchema.safeParse(json)
  if (!parsed.success) return null
  const allowed = new Map<string, string>()
  for (const link of [...chain.required, ...chain.optional]) allowed.set(normalizeLink(link), link)
  const covered = normalizeList(parsed.data.covered, allowed)
  const uncertain = normalizeList(parsed.data.uncertain, allowed)
  const missing = normalizeList(parsed.data.missing, allowed)
  if (covered.length === 0 && uncertain.length === 0 && missing.length === 0) return null
  return { covered, uncertain, missing }
}

/** Rule-only coverage: full-text anchor hit means covered. Never downgrades. */
export function matchRuleCoverage(content: string, chain: ChainCard): Set<string> {
  const haystack = content.toLocaleLowerCase()
  const covered = new Set<string>()
  for (const link of [...chain.required, ...chain.optional]) {
    const anchors = chain.anchors[link] ?? []
    if (anchors.some((anchor) => anchor.trim().length > 0 && haystack.includes(anchor.toLocaleLowerCase()))) {
      covered.add(link)
    }
  }
  return covered
}

/** Weighted coverage over required links. */
export function coverageOf(required: readonly string[], states: Readonly<Record<string, LinkState>>): number {
  if (required.length === 0) return 0
  const weight: Record<LinkState, number> = { covered: 1, uncertain: 0.5, missing: 0 }
  const sum = required.reduce((total, link) => total + weight[states[link] ?? 'missing'], 0)
  return Math.round((sum / required.length) * 100)
}

/** Build the initial all-missing state map. */
export function emptyStates(chain: ChainCard): Record<string, LinkState> {
  const states: Record<string, LinkState> = {}
  for (const link of [...chain.required, ...chain.optional]) states[link] = 'missing'
  return states
}

export interface HysteresisResult {
  state: LinkState
  pending: number
}

/**
 * Apply the UI stability rule: upgrade immediately; downgrade from covered only
 * after two consistent observations. Non-covered changes are immediate.
 */
export function applyHysteresis(previous: LinkState, next: LinkState, pending: number): HysteresisResult {
  if (previous !== 'covered' && next === 'covered') return { state: 'covered', pending: 0 }
  if (previous === 'covered' && next !== 'covered') {
    if (pending + 1 >= 2) return { state: next, pending: 0 }
    return { state: 'covered', pending: pending + 1 }
  }
  return { state: next, pending: 0 }
}

/** One paragraph near the caret, truncated to the model budget. */
export interface CoachParagraph {
  text: string
  index: number
}

export function selectCoachParagraph(content: string, caret: number, maxChars = 1_200): CoachParagraph | null {
  const paragraphs = splitParagraphs(content)
  if (paragraphs.length === 0) return null
  const clamped = Math.max(0, Math.min(caret, content.length))
  let chosen = paragraphs[paragraphs.length - 1]!
  for (const paragraph of paragraphs) {
    if (clamped >= paragraph.start && clamped <= paragraph.end) {
      chosen = paragraph
      break
    }
  }
  let text = chosen.text.trim()
  if (text.length > maxChars) {
    const localCaret = Math.max(0, Math.min(clamped - chosen.start, text.length))
    const start = Math.max(0, Math.min(text.length - maxChars, localCaret - Math.floor(maxChars / 2)))
    text = text.slice(start, start + maxChars)
  }
  if (text.trim().length === 0) return null
  return { text, index: chosen.index }
}

export interface ScanTrigger {
  now: number
  lastInputAt: number
  lastScanAt: number
  charsSinceScan: number
  idleDelayMs: number
  charThreshold: number
  minIntervalMs: number
}

/** Whether the debounce timer should call the coach now. */
export function shouldScan(trigger: ScanTrigger): boolean {
  if (trigger.now - trigger.lastScanAt < trigger.minIntervalMs) return false
  if (trigger.charsSinceScan >= trigger.charThreshold) return true
  return trigger.now - trigger.lastInputAt >= trigger.idleDelayMs
}

/** Derive next states from model lists, leaving unmentioned links untouched. */
export function statesFromParsed(
  previous: Readonly<Record<string, LinkState>>,
  parsed: ParsedCoachStates,
): Record<string, LinkState> {
  const next = { ...previous }
  // Within one response: covered > uncertain > missing; unmentioned links keep
  // their previous state so a paragraph scan cannot silently erase coverage.
  for (const link of parsed.missing) next[link] = 'missing'
  for (const link of parsed.uncertain) next[link] = 'uncertain'
  for (const link of parsed.covered) next[link] = 'covered'
  return next
}

/** Rule upgrade over a previous map (never downgrades). */
export function statesFromRules(
  previous: Readonly<Record<string, LinkState>>,
  covered: ReadonlySet<string>,
): Record<string, LinkState> {
  const next = { ...previous }
  for (const link of covered) next[link] = 'covered'
  return next
}

function normalizeLink(value: string): string {
  return value.replace(/\s+/gu, '').toLocaleLowerCase()
}

function normalizeList(value: readonly unknown[] | undefined, allowed: ReadonlyMap<string, string>): string[] {
  if (value === undefined) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const item of value) {
    const text = textOf(item)
    const link = allowed.get(normalizeLink(text))
    if (link === undefined || seen.has(link)) continue
    seen.add(link)
    out.push(link)
  }
  return out
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'object' && value !== null) {
    for (const key of ['text', 'message', 'issue', 'description', 'content', 'value', 'name', 'link']) {
      const candidate = (value as Record<string, unknown>)[key]
      if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
    }
  }
  return ''
}

function parseJsonObject(raw: string): unknown {
  let text = raw.trim().replace(/^\uFEFF/u, '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)
  if (fenced !== null) text = fenced[1] ?? text
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('no JSON object')
  text = text.slice(first, last + 1).replace(/,\s*([}\]])/gu, '$1')
  return JSON.parse(text) as unknown
}

/** Chain lookup helper shared by Host and UI tests. */
export function chainMatchesQuestion(chain: ChainCard, question: Pick<Question, 'type' | 'chainType'>): boolean {
  if (question.chainType !== undefined && question.chainType === chain.id) return true
  return chain.questionTypes.includes(question.type)
}
