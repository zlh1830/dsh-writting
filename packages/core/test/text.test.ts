import { describe, expect, it } from 'vitest'
import {
  anchorToOffset,
  countWords,
  hashText,
  locateEvidence,
  numberParagraphs,
  parseJsonLoose,
  shortenDirection,
  similarity,
  splitParagraphs,
  splitSentences,
} from '../src/index.js'

const TEXT = '第一段第一句。第一段第二句。\n\n第二段第一句。第二段第二句。'

describe('text coordinates', () => {
  it('counts non-whitespace code points', () => {
    expect(countWords('你好，世界')).toBe(5)
    expect(countWords('a b\nc')).toBe(3)
  })

  it('splits paragraphs with absolute offsets', () => {
    const paragraphs = splitParagraphs(TEXT)
    expect(paragraphs).toHaveLength(2)
    expect(paragraphs[0]?.text).toBe('第一段第一句。第一段第二句。')
    expect(TEXT.slice(paragraphs[1]!.start, paragraphs[1]!.end)).toBe('第二段第一句。第二段第二句。')
  })

  it('splits sentences and keeps punctuation', () => {
    const sentences = splitSentences(splitParagraphs(TEXT)[0]!)
    expect(sentences.map((sentence) => sentence.text)).toEqual(['第一段第一句。', '第一段第二句。'])
  })

  it('resolves 段:句 anchors', () => {
    expect(anchorToOffset(TEXT, '2:1')).not.toBeNull()
    expect(anchorToOffset(TEXT, '2:3')).toBeNull()
    expect(anchorToOffset(TEXT, 'x:1')).toBeNull()
  })

  it('locates evidence quotes', () => {
    expect(locateEvidence(TEXT, '第二段第二句')).toBe('2:2')
    expect(locateEvidence(TEXT, '不存在的句子')).toBeNull()
  })

  it('numbers paragraphs for the judge payload', () => {
    expect(numberParagraphs(TEXT)).toBe('[1] 第一段第一句。第一段第二句。\n\n[2] 第二段第一句。第二段第二句。')
  })
})

describe('parseJsonLoose', () => {
  it('strips fences and prose wrappers', () => {
    const value = parseJsonLoose('说明文字\n```json\n{"a":[1,2,],}\n```\n结束')
    expect(value).toEqual({ a: [1, 2] })
  })

  it('rejects output without an object', () => {
    expect(() => parseJsonLoose('not json')).toThrow()
  })
})

describe('hash and similarity', () => {
  it('is stable and content-sensitive', () => {
    expect(hashText('abc')).toBe(hashText('abc'))
    expect(hashText('abc')).not.toBe(hashText('abd'))
  })

  it('flags near-verbatim text', () => {
    expect(similarity('补写完成时限', '补写完成时限')).toBe(1)
    expect(similarity('完全不同的方向', '补写完成时限')).toBeLessThan(0.2)
  })

  it('shortens a long direction', () => {
    const long = '这是一段很长的模型输出，包含了完整的范文式句子，不应该原样展示。'
    expect(Array.from(shortenDirection(long, 20)).length).toBeLessThanOrEqual(20)
  })
})
