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
8. 总分与五维由服务端计算，你只输出结构化判定，不要输出总分或维度分。

【输出 JSON】
{
  "points": [{"id":"p1","status":"hit|partial|miss","anchor":"2:1","note":"判定依据"}],
  "missingLinks": [],
  "missingPoints": [],
  "emptyPhrases": [{"anchor":"1:2","text":"原文","missing":["时限"]}],
  "formatIssues": [],
  "suggestions": [{"anchor":"2:1","issueType":"缺环节","direction":"补写完成时限","evidence":"原文片段","impact":"high"}],
  "resolved": [{"id":"R1","status":"solved|unsolved"}]
}

判定口径：coverage 按采分点命中率（命中 1、部分 0.5、未命中 0）；chain 看环节是否完整；elements 看必备要素是否齐全；language 看格式与空话；material 看是否贴合材料。这些分数由服务端按你的判定计算，不要自行打分。`

export interface JudgePayload {
  question: Pick<Question, 'id' | 'type' | 'topic' | 'wordLimit' | 'requirement'>
  points: Question['points']
  answer: string
  rubric: {
    weights: JudgeConfig['weights']
    threshold: number
    thresholdState: JudgeConfig['thresholdState']
  }
}

/**
 * Compact variant for small local models. The cloud prompt is precise but long;
 * a 3–9B quantized model spends its budget on the rules and drops point rows.
 * Same output contract, fewer words, and the required point ids are spelled out
 * so "逐个判定" is checkable rather than inferred.
 */
export const LOCAL_JUDGE_SYSTEM_PROMPT = `你是写作训练批改员，只做诊断，不代写。

只输出一个 JSON 对象，不要 markdown 围栏，不要解释。

规则：
1. points 必须逐个判定输入里的每个采分点 id，不遗漏、不新增。
2. status 只能是 hit（命中）、partial（部分）、miss（未命中）。
3. anchor 用 "段号:句号"，段号从 1 开始。
4. suggestions 最多 4 条，direction 是方向、≤40 字、动词开头，不要给整句成稿。
5. missingLinks 写缺失的环节名；missingPoints 写缺失的材料点；formatIssues 写格式问题；拿不准的不要编造。

输出：
{"points":[{"id":"p1","status":"hit","anchor":"1:1","note":"依据"}],"missingLinks":[],"missingPoints":[],"emptyPhrases":[],"formatIssues":[],"suggestions":[{"anchor":"1:1","issueType":"缺环节","direction":"补写完成时限","evidence":"原文","impact":"high"}],"resolved":[]}`

export type JudgeEngine = 'cloud' | 'local'

/**
 * Pick the system prompt for one judge call. The local branch appends the exact
 * point ids so a small model has no reason to invent or skip a row.
 */
export function judgeSystemPrompt(engine: JudgeEngine, question: Question): string {
  if (engine !== 'local') return JUDGE_SYSTEM_PROMPT
  const ids = question.points.map((point) => point.id).join('、')
  const labels = question.points.map((point) => `${point.id}（${point.label}）`).join('；')
  return `${LOCAL_JUDGE_SYSTEM_PROMPT}\n\n本题采分点：${labels}${ids.length === 0 ? '' : `\npoints 必须正好包含这些 id：${ids}`}`
}

/** Build the one user message; material is deliberately not sent after the points were cached. */
export function buildJudgePayload(question: Question, attempt: Attempt, config: JudgeConfig): JudgePayload {
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
    rubric: {
      weights: config.weights,
      threshold: config.passThreshold,
      thresholdState: config.thresholdState,
    },
  }
}
