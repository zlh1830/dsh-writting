/** Stable, user-visible failure codes shared by tools and the Remote service. */
export type TrainErrorCode =
  | 'INVALID_INPUT'
  | 'QUESTION_NOT_FOUND'
  | 'ATTEMPT_NOT_FOUND'
  | 'SESSION_NOT_FOUND'
  | 'EMPTY_ATTEMPT'
  | 'POINTS_EXTRACT_FAILED'
  | 'JUDGE_FAILED'
  | 'NO_PROVIDER'
  /** The local judge engine was requested but its provider is not mounted. */
  | 'NO_LOCAL_JUDGE'
  | 'CHAIN_NOT_FOUND'

export class TrainError extends Error {
  override readonly name = 'TrainError'
  constructor(
    readonly code: TrainErrorCode,
    message: string,
  ) {
    super(message)
  }
}
