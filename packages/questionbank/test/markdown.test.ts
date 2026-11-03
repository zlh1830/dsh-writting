import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseQuestionMarkdown, serializeQuestionMarkdown, toQuestionSummary } from '../src/markdown.js'

async function fixture(name: string): Promise<string> {
  return readFile(resolve(process.cwd(), 'fixtures', 'questions', name), 'utf8')
}

describe('question markdown', () => {
  it('parses frontmatter, material, requirement, and cached points', async () => {
    const { question, warnings } = parseQuestionMarkdown(await fixture('xinfang-001.md'))
    expect(question.id).toBe('xinfang-001')
    expect(question.type).toBe('信访回复')
    expect(question.wordLimit).toBe(600)
    expect(question.material).toContain('某镇居民甲')
    expect(question.requirement).toContain('书面回复')
    expect(question.points).toHaveLength(6)
    expect(question.points[0]).toEqual({ id: 'p1', label: '受理登记', criteria: '写明受理时间、承办单位与联系方式' })
    expect(warnings).toEqual([])
  })

  it('round-trips through the canonical serializer', async () => {
    const { question } = parseQuestionMarkdown(await fixture('tongzhi-001.md'))
    const reparsed = parseQuestionMarkdown(serializeQuestionMarkdown(question)).question
    expect(reparsed).toEqual(question)
  })

  it('summarizes without leaking the material', async () => {
    const { question } = parseQuestionMarkdown(await fixture('duice-001.md'))
    const summary = toQuestionSummary(question)
    expect(summary).toEqual({ id: 'duice-001', type: '对策题', topic: '基层治理', wordLimit: 600, pointsCount: 5 })
  })

  it('requires frontmatter', () => {
    expect(() => parseQuestionMarkdown('## 材料\n正文')).toThrow(/frontmatter/)
  })

  it('accepts a question without points and warns', () => {
    const raw = '---\nid: q2\ntype: 通知\ntopic: 测试\nwordLimit: 300\n---\n\n## 材料\n某部门拟开展检查。\n\n## 作答要求\n起草通知。'
    const parsed = parseQuestionMarkdown(raw)
    expect(parsed.question.points).toEqual([])
    expect(parsed.warnings.join('')).toContain('采分点')
  })
})
