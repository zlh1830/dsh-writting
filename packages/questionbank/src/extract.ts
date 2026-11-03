import { z } from 'zod'
import {
  parseJsonLoose,
  TrainError,
  type LlmClient,
  type Point,
  type Question,
} from '@local/dsh-train-core'

const ExtractionSchema = z.object({
  points: z.array(
    z.object({
      id: z.string().optional(),
      label: z.string(),
      criteria: z.string().optional(),
    }),
  ),
})

const EXTRACT_SYSTEM = `你是写作训练题目的材料分析员。只做一件事：从题目材料与作答要求中抽取采分点。
规则：
1. 只输出一个 JSON 对象，不要 markdown 围栏，不要解释。
2. 输出 5–10 个采分点，每个含 label（不超过 12 字）和 criteria（可判定的标准，不超过 40 字）。
3. 采分点必须是材料或作答要求能支撑的要点，不得编造政策、数据、文号。
4. 无法判断时宁缺毋滥，不要用“语言流畅”“结构完整”这类空泛项凑数。
输出格式：{"points":[{"label":"...","criteria":"..."}]}`

/** Ask the model for the cached point list; callers persist it into the question frontmatter. */
export async function extractPoints(
  client: LlmClient,
  question: Question,
  maxPoints: number,
  signal?: AbortSignal,
): Promise<Point[]> {
  const payload = {
    type: question.type,
    topic: question.topic,
    wordLimit: question.wordLimit,
    material: question.material,
    requirement: question.requirement,
  }
  const completion = await client.complete({
    system: EXTRACT_SYSTEM,
    user: JSON.stringify(payload),
    maxTokens: 800,
    ...(signal === undefined ? {} : { signal }),
  })
  let raw: unknown
  try {
    raw = parseJsonLoose(completion.text)
  } catch (error) {
    throw new TrainError('POINTS_EXTRACT_FAILED', `point extraction returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = ExtractionSchema.safeParse(raw)
  if (!parsed.success) {
    throw new TrainError('POINTS_EXTRACT_FAILED', 'point extraction did not match {points:[{label,criteria}]}')
  }
  const points: Point[] = []
  for (const entry of parsed.data.points) {
    const label = entry.label.trim()
    if (label.length === 0) continue
    points.push({
      id: entry.id?.trim() || `p${points.length + 1}`,
      label,
      criteria: (entry.criteria ?? '').trim(),
    })
    if (points.length >= maxPoints) break
  }
  if (points.length === 0) throw new TrainError('POINTS_EXTRACT_FAILED', 'point extraction returned no usable points')
  return points
}
