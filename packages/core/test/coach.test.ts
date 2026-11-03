import { describe, expect, it } from 'vitest'
import {
  applyHysteresis,
  coverageOf,
  matchRuleCoverage,
  parseCoachJson,
  selectCoachParagraph,
  shouldScan,
  statesFromParsed,
  type ChainCard,
} from '../src/index.js'

const chain: ChainCard = {
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

describe('coach coverage and hysteresis', () => {
  it('computes weighted coverage over required links', () => {
    expect(coverageOf(chain.required, {})).toBe(0)
    expect(coverageOf(chain.required, { 目的: 'covered', 范围: 'covered', 时限: 'uncertain', 验收: 'missing' })).toBe(63)
    expect(coverageOf(chain.required, { 目的: 'covered', 范围: 'covered', 时限: 'covered', 验收: 'covered' })).toBe(100)
  })

  it('upgrades immediately and downgrades after two consistent observations', () => {
    expect(applyHysteresis('missing', 'covered', 0)).toEqual({ state: 'covered', pending: 0 })
    expect(applyHysteresis('covered', 'missing', 0)).toEqual({ state: 'covered', pending: 1 })
    expect(applyHysteresis('covered', 'missing', 1)).toEqual({ state: 'missing', pending: 0 })
    expect(applyHysteresis('uncertain', 'covered', 0)).toEqual({ state: 'covered', pending: 0 })
  })

  it('matches anchors against the full text', () => {
    const covered = matchRuleCoverage('为进一步加强检查，各单位于5个工作日内完成验收。', chain)
    expect([...covered].sort()).toEqual(['目的', '范围', '时限', '验收'].sort())
    expect(matchRuleCoverage('这里没有任何线索。', chain).size).toBe(0)
  })

  it('parses fenced/object-shaped model output and drops unknown links', () => {
    const parsed = parseCoachJson(
      '```json\n{"covered":[{"text":"目的"},{"name":"范围"}],"uncertain":["时限"],"missing":["不存在的环节"],}\n```',
      chain,
    )
    expect(parsed).toEqual({ covered: ['目的', '范围'], uncertain: ['时限'], missing: [] })
    expect(parseCoachJson('not json', chain)).toBeNull()
    expect(parseCoachJson('{"covered":[],"missing":[],"uncertain":[]}', chain)).toBeNull()
  })

  it('applies priority covered > uncertain > missing', () => {
    const next = statesFromParsed({ 目的: 'missing', 范围: 'missing', 时限: 'missing', 验收: 'missing' }, {
      covered: ['目的'],
      uncertain: ['目的', '范围'],
      missing: ['目的', '时限'],
    })
    expect(next).toMatchObject({ 目的: 'covered', 范围: 'uncertain', 时限: 'missing', 验收: 'missing' })
  })

  it('selects the paragraph around the caret and truncates to budget', () => {
    const content = '第一段第一句。\n\n第二段第一句。第二段第二句。'
    const selected = selectCoachParagraph(content, content.indexOf('第二段第二句'), 20)
    expect(selected?.index).toBe(2)
    expect(selected?.text).toContain('第二段')
    expect(Array.from(selected?.text ?? '').length).toBeLessThanOrEqual(20)
  })

  it('implements the idle/character trigger with a cooldown', () => {
    const base = { now: 10_000, lastInputAt: 1_000, lastScanAt: 0, charsSinceScan: 0, idleDelayMs: 3_000, charThreshold: 50, minIntervalMs: 2_000 }
    expect(shouldScan({ ...base, now: 1_500 })).toBe(false)
    expect(shouldScan({ ...base, now: 4_500 })).toBe(true)
    expect(shouldScan({ ...base, now: 4_500, charsSinceScan: 50 })).toBe(true)
    expect(shouldScan({ ...base, now: 4_500, lastScanAt: 4_000 })).toBe(false)
  })
})
