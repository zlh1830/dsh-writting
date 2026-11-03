import type { ChainCard } from '@local/dsh-train-core'

export const COACH_PROMPT_VERSION = 'coach-v1'

/** Build the local model's one-paragraph link-recognition prompt. */
export function buildCoachPrompt(chain: ChainCard, paragraph: string, covered: readonly string[]): { system: string; user: string } {
  const linkLines = [...chain.required, ...chain.optional]
    .map((link) => {
      const anchors = chain.anchors[link] ?? []
      return `- ${link}${anchors.length === 0 ? '' : `（线索：${anchors.join('、')}）`}`
    })
    .join('\n')
  const system = `你是写作训练的环节识别器。只判断给定段落中出现了哪些环节，不评价写得好不好。

链条：${chain.name}
必答环节：${chain.required.join('、')}
可选环节：${chain.optional.join('、')}
环节与线索：
${linkLines}

硬性规则：
1. 只输出一个 JSON 对象，不要 markdown 围栏，不要解释。
2. 只能使用上面出现的环节名，不得发明新环节。
3. 输出三个数组：covered（明确出现）、uncertain（可能提到但不完整）、missing（本段未出现）。
4. 拿不准就放 uncertain，不要硬判 covered。
5. 不要输出正文、改写或建议。`
  const user = `已覆盖环节：${covered.length === 0 ? '无' : covered.join('、')}\n待判断段落：\n${paragraph}`
  return { system, user }
}
