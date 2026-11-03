import type {
  GetHistoryRequest,
  GetQuestionRequest,
  HistoryEntry,
  JudgeRequest,
  JudgeResult,
  ListQuestionsResult,
  Question,
  SaveAttemptRequest,
  SaveAttemptResult,
} from '@local/dsh-train-core'

/** `ctx.remote` result shape for generated unary methods. */
export type RemoteResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code?: string; readonly message: string } }

export interface TrainRemoteNamespace {
  listQuestions(): Promise<RemoteResult<ListQuestionsResult>>
  getQuestion(request: GetQuestionRequest): Promise<RemoteResult<Question>>
  saveAttempt(request: SaveAttemptRequest): Promise<RemoteResult<SaveAttemptResult>>
  judge(request: JudgeRequest, signal?: AbortSignal): Promise<RemoteResult<JudgeResult>>
  getHistory(request: GetHistoryRequest): Promise<RemoteResult<{ entries: HistoryEntry[] }>>
}

export interface ClientRemoteLike {
  $mount(contribution: unknown): Promise<() => Promise<void>>
  train: TrainRemoteNamespace
}

export interface SlotsLike {
  inject(name: string, register: () => unknown): unknown
  register(options: { name: string; id: string; order?: number; label?: string | (() => string) }, component: unknown): unknown
}

export function remoteErrorText(error: { code?: string; message: string }): string {
  return error.code === undefined ? error.message : `${error.code}: ${error.message}`
}
