import { describe, expect, it } from 'vitest'
import { bandOf, composeScore, DEFAULT_WEIGHTS } from '../src/index.js'

describe('composeScore', () => {
  it('weights dimensions and clamps to 100', () => {
    const allPerfect = { coverage: 100, chain: 100, elements: 100, language: 100, material: 100 }
    expect(composeScore(allPerfect, DEFAULT_WEIGHTS, { threshold: 90, thresholdState: 'calibrated' }).total).toBe(100)
    expect(composeScore(allPerfect, DEFAULT_WEIGHTS, { threshold: 90, thresholdState: 'calibrated' }).pass).toBe(true)
  })

  it('returns 0 and fails for empty dimensions', () => {
    const zero = { coverage: 0, chain: 0, elements: 0, language: 0, material: 0 }
    const result = composeScore(zero, DEFAULT_WEIGHTS, { threshold: 90, thresholdState: 'calibrated' })
    expect(result.total).toBe(0)
    expect(result.pass).toBe(false)
    expect(result.band).toBe('D')
  })

  it('caps a blocker at 85', () => {
    const dims = { coverage: 100, chain: 100, elements: 100, language: 100, material: 100 }
    const result = composeScore(dims, DEFAULT_WEIGHTS, { threshold: 90, thresholdState: 'calibrated', blocker: true })
    expect(result.total).toBe(85)
    expect(result.cappedByBlocker).toBe(true)
    expect(result.pass).toBe(false)
  })

  it('requires every dimension threshold independently', () => {
    const dims = { coverage: 79, chain: 100, elements: 100, language: 100, material: 100 }
    const result = composeScore(dims, DEFAULT_WEIGHTS, { threshold: 60, thresholdState: 'calibrating' })
    expect(result.total).toBeGreaterThan(85)
    expect(result.pass).toBe(false)
  })

  it('maps bands', () => {
    expect(bandOf(90)).toBe('A')
    expect(bandOf(75)).toBe('B')
    expect(bandOf(60)).toBe('C')
    expect(bandOf(59)).toBe('D')
  })
})
