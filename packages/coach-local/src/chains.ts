import { copyFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { ChainCardSchema, chainMatchesQuestion, type ChainCard, type Question } from '@local/dsh-train-core'

interface Frontmatter {
  [key: string]: unknown
}

/** Split optional YAML frontmatter from a chain Markdown file. */
export function splitChainFrontmatter(raw: string): { frontmatter: string; body: string } {
  const normalized = raw.replace(/^\uFEFF/u, '').replace(/\r\n/gu, '\n')
  const match = /^---\n([\s\S]*?)\n---\n?/u.exec(normalized)
  if (match === null) return { frontmatter: '', body: normalized }
  return { frontmatter: match[1] ?? '', body: normalized.slice(match[0].length) }
}

/** Parse one chain Markdown file into the validated card shape. */
export function parseChainMarkdown(raw: string, fallbackId: string): ChainCard {
  const { frontmatter } = splitChainFrontmatter(raw)
  if (frontmatter.trim().length === 0) throw new Error('chain markdown requires YAML frontmatter')
  const parsed = parseYaml(frontmatter) as unknown
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('chain frontmatter must be a YAML mapping')
  }
  const front = parsed as Frontmatter
  const id = stringField(front.id) ?? stringField(front.name) ?? fallbackId
  const name = stringField(front.name) ?? id
  const required = stringList(front.required)
  if (required.length === 0) throw new Error(`chain "${id}" requires a non-empty required list`)
  const anchors: Record<string, string[]> = {}
  if (typeof front.anchors === 'object' && front.anchors !== null && !Array.isArray(front.anchors)) {
    for (const [key, value] of Object.entries(front.anchors as Record<string, unknown>)) {
      const list = stringList(value)
      if (list.length > 0) anchors[key] = list
    }
  }
  return ChainCardSchema.parse({
    id,
    name,
    description: stringField(front.description) ?? '',
    questionTypes: stringList(front.questionTypes),
    required,
    optional: stringList(front.optional).filter((link) => !required.includes(link)),
    anchors,
  })
}

/** Load all chain cards, copying packaged seeds only when the user has none. */
export class ChainRegistry {
  private readonly byId = new Map<string, ChainCard>()

  private constructor(cards: readonly ChainCard[]) {
    for (const card of cards) this.byId.set(card.id, card)
  }

  /** Test/helper constructor for already-parsed cards. */
  static fromCards(cards: readonly ChainCard[]): ChainRegistry {
    return new ChainRegistry(cards)
  }

  static async load(chainDir: string, seedDir: string): Promise<ChainRegistry> {
    await mkdir(chainDir, { recursive: true })
    await ensureSeeds(chainDir, seedDir)
    const files = await readdir(chainDir, { withFileTypes: true })
    const cards: ChainCard[] = []
    for (const file of files) {
      if (!file.isFile() || !file.name.endsWith('.md')) continue
      try {
        const raw = await readFile(join(chainDir, file.name), 'utf8')
        cards.push(parseChainMarkdown(raw, file.name.slice(0, -3)))
      } catch (error) {
        console.warn(`[dsh-train] skipping unreadable chain ${file.name}: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return new ChainRegistry(cards)
  }

  get(id: string): ChainCard | undefined {
    return this.byId.get(id)
  }

  find(question: Pick<Question, 'type' | 'chainType'>): ChainCard | undefined {
    if (question.chainType !== undefined) {
      const direct = this.byId.get(question.chainType)
      if (direct !== undefined) return direct
    }
    for (const card of this.byId.values()) {
      if (chainMatchesQuestion(card, question)) return card
    }
    return undefined
  }

  get count(): number {
    return this.byId.size
  }

  list(): ChainCard[] {
    return [...this.byId.values()]
  }
}

async function ensureSeeds(chainDir: string, seedDir: string): Promise<void> {
  const existing = await readdir(chainDir, { withFileTypes: true }).catch(() => [])
  if (existing.some((file) => file.isFile() && file.name.endsWith('.md'))) return
  const seeds = await readdir(seedDir, { withFileTypes: true }).catch(() => [])
  for (const seed of seeds) {
    if (!seed.isFile() || !seed.name.endsWith('.md')) continue
    await copyFile(join(seedDir, seed.name), join(chainDir, seed.name))
  }
}

function stringField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  return trimmed.length === 0 ? undefined : trimmed
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
    .filter((entry) => entry.length > 0)
}
