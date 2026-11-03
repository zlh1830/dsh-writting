export interface DraftState {
  questionId: string
  content: string
  elapsedMs: number
  running: boolean
  updatedAt: number
}

const PREFIX = 'dsh.train.draft.v1'

function keyOf(sessionId: string, questionId: string): string {
  return `${PREFIX}.${sessionId}.${questionId}`
}

export function loadDraft(sessionId: string, questionId: string): DraftState | null {
  try {
    const raw = globalThis.localStorage?.getItem(keyOf(sessionId, questionId))
    if (raw === null || raw === undefined) return null
    const parsed = JSON.parse(raw) as Partial<DraftState>
    if (typeof parsed.content !== 'string' || typeof parsed.elapsedMs !== 'number') return null
    return {
      questionId,
      content: parsed.content,
      elapsedMs: Math.max(0, parsed.elapsedMs),
      running: parsed.running === true,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    }
  } catch {
    return null
  }
}

export function saveDraft(sessionId: string, draft: DraftState): void {
  try {
    globalThis.localStorage?.setItem(keyOf(sessionId, draft.questionId), JSON.stringify(draft))
  } catch {
    // A full or disabled localStorage must not break writing.
  }
}

export function loadLastQuestion(sessionId: string): string | null {
  try {
    return globalThis.localStorage?.getItem(`${PREFIX}.last.${sessionId}`) ?? null
  } catch {
    return null
  }
}

export function saveLastQuestion(sessionId: string, questionId: string): void {
  try {
    globalThis.localStorage?.setItem(`${PREFIX}.last.${sessionId}`, questionId)
  } catch {
    // ignore
  }
}
