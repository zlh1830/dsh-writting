import { describe, expect, it } from 'vitest'
import { TrainError, type LlmClient, type LlmCompletion, type Question } from '@local/dsh-train-core'
import { extractPoints } from '../src/extract.js'

const question: Question = {
  id: 'q1',
  type: '通知',
  topic: '专项检查',
  wordLimit: 500,
  material: '某部门拟开展安全生产专项检查。',
  requirement: '起草通知。',
  points: [],
}

class FakeClient implements LlmClient {
  calls = 0
  constructor(private readonly outputs: string[]) {}
  async complete(): Promise<LlmCompletion> {
    const text = this.outputs[this.calls] ?? this.outputs[this.outputs.length - 1] ?? ''
    this.calls += 1
    return { text, usage: { input: 10, output: 20 }, finish: 'stop', truncated: false }
  }
}

describe('point extraction', () => {
  it('parses model points and assigns stable ids', async () => {
    const client = new FakeClient(['{"points":[{"label":"检查目的","criteria":"写明背景"},{"label":"时限","criteria":"写明节点"}]}'])
    const points = await extractPoints(client, question, 10)
    expect(points).toEqual([
      { id: 'p1', label: '检查目的', criteria: '写明背景' },
      { id: 'p2', label: '时限', criteria: '写明节点' },
    ])
  })

  it('rejects invalid JSON as POINTS_EXTRACT_FAILED', async () => {
    const client = new FakeClient(['不是 JSON'])
    await expect(extractPoints(client, question, 10)).rejects.toMatchObject({ code: 'POINTS_EXTRACT_FAILED' })
  })

  it('rejects an empty point list', async () => {
    const client = new FakeClient(['{"points":[]}'])
    await expect(extractPoints(client, question, 10)).rejects.toBeInstanceOf(TrainError)
  })
})
