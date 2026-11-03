import { numberParagraphs, type Attempt, type JudgeConfig, type Question } from '@local/dsh-train-core'

export const JUDGE_SYSTEM_PROMPT = `你是一名写作训练批改员。你的任务只有一个：诊断，不代写。

【硬性规则】
1. 只输出一个 JSON 对象，不要 markdown 围栏，不要任何解释文字。
2. 每条建议的 direction 必须是“方向”，≤60 字，动词开头；不得给出可直接粘贴的完整句子或整段。
3. 不得输出整段改写、范文、或“把这句话改成：……”的成品句。
4. anchor 必须能在正文定位，格式 "段号:句号"；evidence 引用原文 ≤30 字。
5. 无法判断的要点写进 missingPoints，不要编造材料里没有的内容。
6. 不评价政策表述是否正确；涉及政策只提示“需人工核对官网原文”。
7. 采分点必须逐个判定，不得遗漏或新增 id。

【输出 JSON】
{
  "dimensions": {"coverage":0,"chain":0,"elements":0,"language":0,"material":0},
  "points": [{"id":"p1","status":"hit|partial|miss","anchor":"2:1","note":"判定依据"}],
  "missingLinks": [],
  "missingPoints": [],
  "emptyPhrases": [{"anchor":"1:2","text":"原文","missing":["时限"]}],
  "formatIssues": [],
  "suggestions": [{"anchor":"2:1","issueType":"缺环节","direction":"补写完成时限","evidence":"原文片段","impact":"high"}],
  "resolved": [{"id":"R1","status":"solved|unsolved"}]
}

维度含义：coverage 采分点覆盖 40%；chain 链条完整 20%；elements 六要素执行 20%；language 语言与格式 10%；material 材料贴合 10%。分数由服务端合成，不要输出总分。`

export interface JudgePayload {
  question: Pick<Question, 'id' | 'type' | 'topic' | 'wordLimit' | 'requirement'>
  points: Question['points']
  answer: string
  prev: { score: number; unresolved: string[] } | null
  rubric: {
    weights: JudgeConfig['weights']
    threshold: number
    thresholdState: JudgeConfig['thresholdState']
  }
}

/** Build the one user message; material is deliberately not sent after the points were cached. */
export function buildJudgePayload(
  question: Question,
  attempt: Attempt,
  config: JudgeConfig,
  previous: { score: number; unresolved: string[] } | null,
): JudgePayload {
  return {
    question: {
      id: question.id,
      type: question.type,
      topic: question.topic,
      wordLimit: question.wordLimit,
      requirement: question.requirement,
    },
    points: question.points,
    answer: numberParagraphs(attempt.content),
    prev: previous,
    rubric: {
      weights: config.weights,
      threshold: config.passThreshold,
      thresholdState: config.thresholdState,
    },
  }
}
