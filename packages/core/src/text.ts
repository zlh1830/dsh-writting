/** Paragraph and sentence coordinates plus small text helpers shared by host and client. */

export interface Paragraph {
  index: number
  start: number
  end: number
  text: string
}

export interface Sentence {
  paragraph: number
  index: number
  start: number
  end: number
  text: string
}

export interface AnchorRange {
  paragraph: number
  sentence: number
  start: number
  end: number
}

/** Count non-whitespace Unicode code points, the plugin's Chinese-first word rule. */
export function countWords(text: string): number {
  return Array.from(text.replace(/\s/gu, '')).length
}

/** Split on blank lines while preserving absolute offsets. */
export function splitParagraphs(text: string): Paragraph[] {
  if (text.length === 0) return []
  const paragraphs: Paragraph[] = []
  const separator = /\n[ \t]*\n/g
  let start = 0
  let match: RegExpExecArray | null
  while ((match = separator.exec(text)) !== null) {
    pushParagraph(paragraphs, text, start, match.index)
    start = separator.lastIndex
  }
  pushParagraph(paragraphs, text, start, text.length)
  return paragraphs
}

function pushParagraph(out: Paragraph[], text: string, start: number, end: number): void {
  const raw = text.slice(start, end)
  if (raw.trim().length === 0) return
  out.push({ index: out.length + 1, start, end, text: raw })
}

/** Split one paragraph on Chinese sentence punctuation; punctuation stays with the sentence. */
export function splitSentences(paragraph: Paragraph): Sentence[] {
  const sentences: Sentence[] = []
  const matcher = /[^。；！？\n]+[。；！？]?/g
  let match: RegExpExecArray | null
  while ((match = matcher.exec(paragraph.text)) !== null) {
    const raw = match[0]
    const leading = raw.length - raw.trimStart().length
    const trimmed = raw.trim()
    if (trimmed.length === 0) continue
    const start = paragraph.start + match.index + leading
    sentences.push({
      paragraph: paragraph.index,
      index: sentences.length + 1,
      start,
      end: start + trimmed.length,
      text: trimmed,
    })
  }
  if (sentences.length === 0 && paragraph.text.trim().length > 0) {
    const start = paragraph.start + paragraph.text.indexOf(paragraph.text.trim())
    sentences.push({ paragraph: paragraph.index, index: 1, start, end: start + paragraph.text.trim().length, text: paragraph.text.trim() })
  }
  return sentences
}

/** Convert `段:句` (one-based) into an absolute character range. */
export function anchorToOffset(text: string, anchor: string): AnchorRange | null {
  const match = /^(\d+):(\d+)$/u.exec(anchor.trim())
  if (match === null) return null
  const paragraphIndex = Number(match[1])
  const sentenceIndex = Number(match[2])
  if (!Number.isSafeInteger(paragraphIndex) || !Number.isSafeInteger(sentenceIndex)) return null
  const paragraphs = splitParagraphs(text)
  const paragraph = paragraphs[paragraphIndex - 1]
  if (paragraph === undefined) return null
  const sentence = splitSentences(paragraph)[sentenceIndex - 1]
  if (sentence === undefined) return null
  return { paragraph: paragraphIndex, sentence: sentenceIndex, start: sentence.start, end: sentence.end }
}

/** Locate a direct evidence quote and derive its `段:句` anchor. */
export function locateEvidence(text: string, evidence: string): string | null {
  const needle = evidence.trim()
  if (needle.length < 2) return null
  const offset = text.indexOf(needle)
  if (offset < 0) return null
  const paragraphs = splitParagraphs(text)
  for (const paragraph of paragraphs) {
    if (offset < paragraph.start || offset >= paragraph.end) continue
    for (const sentence of splitSentences(paragraph)) {
      if (offset >= sentence.start && offset < sentence.end) return `${sentence.paragraph}:${sentence.index}`
    }
    return `${paragraph.index}:1`
  }
  return null
}

/** Resolve an anchor, falling back to the evidence quote. */
export function resolveAnchor(text: string, anchor: string | undefined, evidence: string | undefined): string | null {
  if (anchor !== undefined && anchorToOffset(text, anchor) !== null) return anchor.trim()
  if (evidence !== undefined && evidence.trim().length > 0) return locateEvidence(text, evidence)
  return null
}

/** Number paragraphs as `[1] ...`, the judge payload's stable coordinate form. */
export function numberParagraphs(text: string): string {
  const paragraphs = splitParagraphs(text)
  if (paragraphs.length === 0) return ''
  return paragraphs.map((paragraph) => `[${paragraph.index}] ${paragraph.text.trim()}`).join('\n\n')
}

/** Stable, cheap content fingerprint for idempotency (FNV-1a 32-bit). */
export function hashText(text: string): string {
  let hash = 0x811c9dc5
  for (const char of text) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** Parse model JSON with fences, prose wrappers, and trailing commas tolerated. */
export function parseJsonLoose(raw: string): unknown {
  let text = raw.trim().replace(/^\uFEFF/u, '')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/iu.exec(text)
  if (fenced !== null) text = fenced[1] ?? text
  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first < 0 || last < first) throw new Error('no JSON object found in model output')
  text = text.slice(first, last + 1).replace(/,\s*([}\]])/gu, '$1')
  return JSON.parse(text) as unknown
}

/** Bigram Jaccard similarity in [0, 1]; used only to flag near-verbatim rewrites. */
export function similarity(left: string, right: string): number {
  const a = bigrams(left)
  const b = bigrams(right)
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const gram of a) if (b.has(gram)) intersection += 1
  return intersection / (a.size + b.size - intersection)
}

function bigrams(value: string): Set<string> {
  const chars = Array.from(value.replace(/\s/gu, ''))
  const grams = new Set<string>()
  for (let index = 0; index + 1 < chars.length; index += 1) {
    grams.add(`${chars[index]}${chars[index + 1]}`)
  }
  return grams
}

/** Collapse a long model sentence into a direction-sized phrase. */
export function shortenDirection(value: string, max = 60): string {
  const normalized = value.replace(/\s+/gu, ' ').trim()
  if (normalized.length <= max) return normalized
  const firstClause = normalized.split(/[。；]/u)[0] ?? normalized
  const base = firstClause.trim()
  if (base.length <= max) return base
  return `${Array.from(base).slice(0, max - 1).join('')}…`
}
