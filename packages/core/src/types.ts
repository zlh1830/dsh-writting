import { z } from 'zod'

/** A scored point extracted from the question material. */
export const PointSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  criteria: z.string().default(''),
})
export type Point = z.infer<typeof PointSchema>

/** One imported question, including the cached point list. */
export const QuestionSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]+$/, 'question id must be [a-zA-Z0-9_-]+'),
  type: z.string().min(1),
  topic: z.string().min(1),
  wordLimit: z.number().int().positive(),
  material: z.string().default(''),
  requirement: z.string().default(''),
  difficulty: z.string().optional(),
  source: z.string().optional(),
  chainType: z.string().optional(),
  points: z.array(PointSchema).default([]),
})
export type Question = z.infer<typeof QuestionSchema>

/** Compact question row used by the answer view. */
export const QuestionSummarySchema = z.object({
  id: z.string(),
  type: z.string(),
  topic: z.string(),
  wordLimit: z.number().int(),
  pointsCount: z.number().int(),
})
export type QuestionSummary = z.infer<typeof QuestionSummarySchema>

/** Request/result payloads crossing the client boundary. */
export const ListQuestionsRequestSchema = z.object({}).strict()
export type ListQuestionsRequest = z.infer<typeof ListQuestionsRequestSchema>

export const GetQuestionRequestSchema = z.object({ questionId: z.string().min(1) }).strict()
export type GetQuestionRequest = z.infer<typeof GetQuestionRequestSchema>

export const SaveAttemptRequestSchema = z
  .object({
    sessionId: z.string().min(1),
    questionId: z.string().min(1),
    content: z.string(),
    elapsedMs: z.number().int().nonnegative().default(0),
  })
  .strict()
export type SaveAttemptRequest = z.infer<typeof SaveAttemptRequestSchema>

export const JudgeRequestSchema = z.object({ attemptId: z.string().min(1) }).strict()
export type JudgeRequest = z.infer<typeof JudgeRequestSchema>

export const GetHistoryRequestSchema = z.object({ questionId: z.string().min(1) }).strict()
export type GetHistoryRequest = z.infer<typeof GetHistoryRequestSchema>

export const AttemptSchema = z.object({
  attemptId: z.string(),
  questionId: z.string(),
  sessionId: z.string(),
  roundId: z.number().int().nonnegative(),
  attemptNo: z.number().int().positive(),
  content: z.string(),
  wordCount: z.number().int().nonnegative(),
  elapsedMs: z.number().int().nonnegative(),
  contentHash: z.string(),
  submittedAt: z.number().int(),
})
export type Attempt = z.infer<typeof AttemptSchema>

export const SaveAttemptResultSchema = z.object({
  attemptId: z.string(),
  attemptNo: z.number().int(),
  wordCount: z.number().int(),
  contentHash: z.string(),
  submittedAt: z.number().int(),
})
export type SaveAttemptResult = z.infer<typeof SaveAttemptResultSchema>

export const DimsSchema = z.object({
  coverage: z.number(),
  chain: z.number(),
  elements: z.number(),
  language: z.number(),
  material: z.number(),
})
export type Dims = z.infer<typeof DimsSchema>

export const PointStatusSchema = z.enum(['hit', 'partial', 'miss'])
export type PointStatus = z.infer<typeof PointStatusSchema>

export const PointJudgmentSchema = z.object({
  id: z.string(),
  status: PointStatusSchema,
  anchor: z.string().optional(),
  note: z.string().optional(),
})
export type PointJudgment = z.infer<typeof PointJudgmentSchema>

export const ImpactSchema = z.enum(['high', 'mid', 'low'])
export type Impact = z.infer<typeof ImpactSchema>

export const SuggestionSchema = z.object({
  id: z.string(),
  anchor: z.string(),
  issueType: z.string(),
  direction: z.string(),
  evidence: z.string().default(''),
  impact: ImpactSchema.default('mid'),
  guard: z.boolean().optional(),
})
export type Suggestion = z.infer<typeof SuggestionSchema>

export const EmptyPhraseSchema = z.object({
  anchor: z.string(),
  text: z.string(),
  missing: z.array(z.string()).default([]),
})
export type EmptyPhrase = z.infer<typeof EmptyPhraseSchema>

export const ResolvedSchema = z.object({
  id: z.string(),
  status: z.enum(['solved', 'unsolved']),
})
export type Resolved = z.infer<typeof ResolvedSchema>

export const TokenUsageSchema = z.object({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
  total: z.number().int().nonnegative().optional(),
})
export type TokenUsage = z.infer<typeof TokenUsageSchema>

export const JudgeResultSchema = z.object({
  attemptId: z.string(),
  questionId: z.string(),
  score: z.number().int(),
  pass: z.boolean(),
  thresholdState: z.enum(['calibrating', 'calibrated']),
  dims: DimsSchema,
  points: z.array(PointJudgmentSchema),
  missingLinks: z.array(z.string()),
  missingPoints: z.array(z.string()),
  suggestions: z.array(SuggestionSchema),
  emptyPhrases: z.array(EmptyPhraseSchema),
  formatIssues: z.array(z.string()),
  resolved: z.array(ResolvedSchema),
  reference: z.string().nullable(),
  guardFlags: z.array(z.string()),
  tokenUsage: TokenUsageSchema,
  modelId: z.string(),
  promptVersion: z.string(),
  weightsVersion: z.string(),
  contentHash: z.string(),
  createdAt: z.number().int(),
  unstable: z.boolean(),
  badAnchorCount: z.number().int().nonnegative(),
})
export type JudgeResult = z.infer<typeof JudgeResultSchema>

export const HistoryEntrySchema = z.object({
  attempt: AttemptSchema.omit({ content: true }),
  /** The submitted draft, so the answer view can show and anchor a historical attempt. */
  content: z.string(),
  judge: JudgeResultSchema.nullable(),
})
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>

export const HistoryResultSchema = z.object({
  entries: z.array(HistoryEntrySchema),
})
export type HistoryResult = z.infer<typeof HistoryResultSchema>

export const ListQuestionsResultSchema = z.object({
  questions: z.array(QuestionSummarySchema),
})
export type ListQuestionsResult = z.infer<typeof ListQuestionsResultSchema>

export interface JudgeWeights {
  coverage: number
  chain: number
  elements: number
  language: number
  material: number
}

export const DEFAULT_WEIGHTS: JudgeWeights = {
  coverage: 0.4,
  chain: 0.2,
  elements: 0.2,
  language: 0.1,
  material: 0.1,
}

export interface JudgeConfig {
  provider: string
  model: string
  passThreshold: number
  thresholdState: 'calibrating' | 'calibrated'
  requestTimeoutMs: number
  maxOutputTokens: number
  weights: JudgeWeights
}

export const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  passThreshold: 90,
  thresholdState: 'calibrating',
  requestTimeoutMs: 45_000,
  maxOutputTokens: 1_200,
  weights: DEFAULT_WEIGHTS,
}

export const PROMPT_VERSION = 'judge-v1'
export const WEIGHTS_VERSION = 'weights-v1'
export const POINTS_PROMPT_VERSION = 'points-v1'

/** Reserved for the M4 fallback gate; the table is created now to keep domain v1 stable. */
export const FallbackSchema = z.object({
  questionId: z.string(),
  roundId: z.number().int().nonnegative(),
  count: z.number().int().nonnegative(),
  unlocked: z.boolean(),
  unlockedAt: z.number().int().optional(),
  lastContentHash: z.string(),
})
export type Fallback = z.infer<typeof FallbackSchema>

