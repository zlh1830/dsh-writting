import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { QuestionSchema, type Point, type Question, type QuestionSummary } from '@local/dsh-train-core'

export interface ParsedQuestion {
  question: Question
  warnings: string[]
}

interface Frontmatter {
  [key: string]: unknown
}

/** Split optional YAML frontmatter from the Markdown body. */
export function splitFrontmatter(raw: string): { frontmatter: string; body: string } {
  const normalized = raw.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(normalized)
  if (match === null) return { frontmatter: '', body: normalized }
  return { frontmatter: match[1] ?? '', body: normalized.slice(match[0].length) }
}

/** Parse one question Markdown file. */
export function parseQuestionMarkdown(raw: string, fallbackId?: string): ParsedQuestion {
  const { frontmatter, body } = splitFrontmatter(raw)
  if (frontmatter.trim().length === 0) {
    throw new Error('question markdown requires YAML frontmatter with id/type/topic/wordLimit')
  }
  const parsed = parseYaml(frontmatter) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('question frontmatter must be a YAML mapping')
  }
  const front = parsed as Frontmatter
  const warnings: string[] = []
  const id = stringField(front.id) ?? fallbackId
  if (id === undefined) throw new Error('question frontmatter requires an id or a file-derived id')
  const type = stringField(front.type)
  const topic = stringField(front.topic)
  if (type === undefined) throw new Error(`question "${id}" requires type`)
  if (topic === undefined) throw new Error(`question "${id}" requires topic`)
  const wordLimit = numberField(front.wordLimit)
  if (wordLimit === undefined) throw new Error(`question "${id}" requires a numeric wordLimit`)

  const material = sectionOf(body, ['材料', '给定材料']) ?? body.trim()
  const requirement = sectionOf(body, ['作答要求', '要求']) ?? ''
  if (material.trim().length === 0) warnings.push('题目材料为空')

  const points = normalizePoints(front.points)
  const question = QuestionSchema.parse({
    id,
    type,
    topic,
    wordLimit,
    material,
    requirement,
    ...(stringField(front.difficulty) === undefined ? {} : { difficulty: stringField(front.difficulty) }),
    ...(stringField(front.source) === undefined ? {} : { source: stringField(front.source) }),
    ...(stringField(front.chainType) === undefined ? {} : { chainType: stringField(front.chainType) }),
    points,
  })
  if (points.length === 0) warnings.push('题目还没有采分点，导入时会尝试抽取')
  return { question, warnings }
}

/** Serialize a question back to the canonical Markdown form. */
export function serializeQuestionMarkdown(question: Question): string {
  const frontmatter = stringifyYaml({
    id: question.id,
    type: question.type,
    topic: question.topic,
    wordLimit: question.wordLimit,
    ...(question.difficulty === undefined ? {} : { difficulty: question.difficulty }),
    ...(question.source === undefined ? {} : { source: question.source }),
    ...(question.chainType === undefined ? {} : { chainType: question.chainType }),
    points: question.points,
  }).trimEnd()
  return `---\n${frontmatter}\n---\n\n## 材料\n\n${question.material.trim()}\n\n## 作答要求\n\n${question.requirement.trim()}\n`
}

export function toQuestionSummary(question: Question): QuestionSummary {
  return {
    id: question.id,
    type: question.type,
    topic: question.topic,
    wordLimit: question.wordLimit,
    pointsCount: question.points.length,
  }
}

function sectionOf(body: string, names: readonly string[]): string | undefined {
  const lines = body.split('\n')
  const escaped = names.map((name) => name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|')
  const heading = new RegExp(`^##\\s*(?:${escaped})\\s*$`, 'u')
  const nextHeading = /^##\s+/u
  let collecting = false
  const output: string[] = []
  for (const line of lines) {
    if (heading.test(line)) {
      collecting = true
      continue
    }
    if (collecting && nextHeading.test(line)) break
    if (collecting) output.push(line)
  }
  if (!collecting) return undefined
  return output.join('\n').trim()
}

function normalizePoints(value: unknown): Point[] {
  if (!Array.isArray(value)) return []
  const points: Point[] = []
  value.forEach((entry, index) => {
    if (typeof entry === 'string') {
      const label = entry.trim()
      if (label.length > 0) points.push({ id: `p${index + 1}`, label, criteria: '' })
      return
    }
    if (typeof entry !== 'object' || entry === null) return
    const record = entry as Record<string, unknown>
    const label = stringField(record.label)
    if (label === undefined) return
    points.push({
      id: stringField(record.id) ?? `p${index + 1}`,
      label,
      criteria: stringField(record.criteria) ?? '',
    })
  })
  return points
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function numberField(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return Math.trunc(value)
  if (typeof value === 'string') {
    const match = /\d+/u.exec(value)
    if (match !== null) {
      const parsed = Number(match[0])
      if (Number.isFinite(parsed) && parsed > 0) return parsed
    }
  }
  return undefined
}
