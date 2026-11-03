import type { Dims, JudgeWeights } from './types.js'

export type ScoreBand = 'A' | 'B' | 'C' | 'D'

export interface ScoreOptions {
  threshold: number
  thresholdState: 'calibrating' | 'calibrated'
  blocker?: boolean
}

export interface ScoreComputation {
  total: number
  raw: number
  pass: boolean
  band: ScoreBand
  cappedByBlocker: boolean
}

const DIMENSION_KEYS = ['coverage', 'chain', 'elements', 'language', 'material'] as const

/** Weighted score composition; the model never supplies the total. */
export function composeScore(dims: Dims, weights: JudgeWeights, options: ScoreOptions): ScoreComputation {
  let raw = 0
  for (const key of DIMENSION_KEYS) {
    const value = dims[key]
    const weight = weights[key]
    if (!Number.isFinite(value) || !Number.isFinite(weight)) {
      throw new Error(`composeScore: dimension ${key} is not a finite number`)
    }
    raw += value * weight
  }
  let total = clamp(Math.round(raw), 0, 100)
  let cappedByBlocker = false
  if (options.blocker === true && total > 85) {
    total = 85
    cappedByBlocker = true
  }
  const band = bandOf(total)
  const pass =
    total >= options.threshold &&
    dims.coverage >= 90 &&
    dims.chain >= 90 &&
    dims.elements >= 85 &&
    options.blocker !== true
  return { total, raw, pass, band, cappedByBlocker }
}

export function bandOf(total: number): ScoreBand {
  if (total >= 85) return 'A'
  if (total >= 75) return 'B'
  if (total >= 60) return 'C'
  return 'D'
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}
