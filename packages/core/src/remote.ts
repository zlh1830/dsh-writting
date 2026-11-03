import { z } from 'zod'
import { createTypertRemoteInfo } from '@deepseek-ai/dsh-typert-protocol/remote-info'
import type { TypertRemoteCodecSpec } from '@deepseek-ai/dsh-typert-protocol'
import {
  ChainSnapshotSchema,
  CoachCheckRequestSchema,
  CoachConfigResultSchema,
  CoachProbeResultSchema,
  CoachResetRequestSchema,
  CoachScanRequestSchema,
  GetChainRequestSchema,
  GetChainResultSchema,
} from './coach.js'
import {
  GetHistoryRequestSchema,
  GetQuestionRequestSchema,
  HistoryResultSchema,
  JudgeRequestSchema,
  JudgeResultSchema,
  ListQuestionsResultSchema,
  QuestionSchema,
  SaveAttemptRequestSchema,
  SaveAttemptResultSchema,
} from './types.js'

function strictCodec<T>(typeSymbol: string, schema: z.ZodType<T>): TypertRemoteCodecSpec {
  return {
    mode: 'strict',
    typeSymbol,
    create: () => schema,
  }
}

function requestParameter<T>(typeSymbol: string, schema: z.ZodType<T>) {
  return {
    name: 'request',
    description: 'Named request payload.',
    source: 'json' as const,
    codec: strictCodec(typeSymbol, schema),
    strictCodec: strictCodec(typeSymbol, schema),
  }
}

const spec = {
  package: '@local/dsh-train-core',
  methods: {
    'train/listQuestions': {
      service: 'trainQuestionBank',
      implementation: 'listQuestions',
      description: 'List imported training questions.',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: strictCodec('@local/dsh-train-core#train/listQuestions:result', ListQuestionsResultSchema),
    },
    'train/getQuestion': {
      service: 'trainQuestionBank',
      implementation: 'getQuestion',
      description: 'Read one question with material, requirement, and cached points.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/getQuestion:request', GetQuestionRequestSchema)],
      result: strictCodec('@local/dsh-train-core#train/getQuestion:result', QuestionSchema),
    },
    'train/saveAttempt': {
      service: 'trainQuestionBank',
      implementation: 'saveAttempt',
      description: 'Persist one immutable answer attempt.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/saveAttempt:request', SaveAttemptRequestSchema)],
      result: strictCodec('@local/dsh-train-core#train/saveAttempt:result', SaveAttemptResultSchema),
    },
    'train/judge': {
      service: 'trainJudge',
      implementation: 'judge',
      description: 'Judge one saved attempt and persist the scorecard.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/judge:request', JudgeRequestSchema)],
      cancellation: { parameter: 'signal' },
      result: strictCodec('@local/dsh-train-core#train/judge:result', JudgeResultSchema),
    },
    'train/getHistory': {
      service: 'trainQuestionBank',
      implementation: 'getHistory',
      description: 'Read recent attempts and their judge summaries for one question.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/getHistory:request', GetHistoryRequestSchema)],
      result: strictCodec('@local/dsh-train-core#train/getHistory:result', HistoryResultSchema),
    },
    'train/getChain': {
      service: 'trainCoach',
      implementation: 'getChain',
      description: 'Read the chain card and the current ephemeral coach snapshot.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/getChain:request', GetChainRequestSchema)],
      result: strictCodec('@local/dsh-train-core#train/getChain:result', GetChainResultSchema),
    },
    'train/coachScan': {
      service: 'trainCoach',
      implementation: 'scan',
      description: 'Recognize one paragraph against the chain and merge the stable snapshot.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/coachScan:request', CoachScanRequestSchema)],
      cancellation: { parameter: 'signal' },
      result: strictCodec('@local/dsh-train-core#train/coachScan:result', ChainSnapshotSchema),
    },
    'train/coachCheck': {
      service: 'trainCoach',
      implementation: 'check',
      description: 'Run a full manual chain check over the current draft.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/coachCheck:request', CoachCheckRequestSchema)],
      cancellation: { parameter: 'signal' },
      result: strictCodec('@local/dsh-train-core#train/coachCheck:result', ChainSnapshotSchema),
    },
    'train/coachReset': {
      service: 'trainCoach',
      implementation: 'reset',
      description: 'Drop the ephemeral coach snapshot for one session/question pair.',
      invocation: { kind: 'direct' as const },
      parameters: [requestParameter('@local/dsh-train-core#train/coachReset:request', CoachResetRequestSchema)],
      result: strictCodec('@local/dsh-train-core#train/coachReset:result', z.object({ ok: z.boolean() })),
    },
    'train/coachConfig': {
      service: 'trainCoach',
      implementation: 'config',
      description: 'Read the coach provider/model/mode and chain count for settings.',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: strictCodec('@local/dsh-train-core#train/coachConfig:result', CoachConfigResultSchema),
    },
    'train/coachProbe': {
      service: 'trainCoach',
      implementation: 'probe',
      description: 'Probe only the configured local provider; never falls back to a cloud route.',
      invocation: { kind: 'direct' as const },
      parameters: [],
      result: strictCodec('@local/dsh-train-core#train/coachProbe:result', CoachProbeResultSchema),
    },
  },
}

/** Host-for-Client contribution mounted by the writing view. */
export const TRAIN_REMOTE = createTypertRemoteInfo(
  spec as Parameters<typeof createTypertRemoteInfo>[0],
  z,
)

export default TRAIN_REMOTE
