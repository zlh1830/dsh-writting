import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/**
 * The client contribution (`TRAIN_REMOTE`) addresses coach endpoints as
 * `train/coachScan`, `train/coachCheck`, ... while the host class methods are
 * named `scan`, `check`, ... The host SRC fallback claims `namespace/exportName`,
 * so a missing decorator name makes the call 404 with
 * `transport failure for /api/train/coachScan`. Keep the two lists in sync.
 */
describe('coach remote names', () => {
  it('host decorators match the client contribution endpoints', async () => {
    const client = await readFile(new URL('../../core/src/remote.ts', import.meta.url), 'utf8')
    const host = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8')

    const endpoints = [...client.matchAll(/'train\/(coach[A-Za-z]+)'/g)].map((match) => match[1]!).sort()
    const decorators = [...host.matchAll(/@Remote\('([A-Za-z]+)'\)/g)].map((match) => match[1]!).sort()

    expect(endpoints).toEqual(['coachCheck', 'coachConfig', 'coachProbe', 'coachReset', 'coachScan'])
    expect(decorators).toEqual(endpoints)
  })
})
