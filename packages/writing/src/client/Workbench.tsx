import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  countWords,
  hashText,
  splitParagraphs,
  splitSentences,
  type HistoryEntry,
  type JudgeResult,
  type Question,
  type QuestionSummary,
} from '@local/dsh-train-core'
import { loadDraft, loadLastQuestion, saveDraft, saveLastQuestion } from './draft.js'
import { remoteErrorText, type TrainRemoteNamespace } from './remote.js'

export interface WritingWorkbenchProps {
  sessionId: string
  remote: TrainRemoteNamespace
}

/** DSH theme tokens (light/dark aware); fallbacks keep the view readable without a host theme. */
const theme = {
  text: 'var(--dsw-alias-label-primary, inherit)',
  muted: 'var(--dsw-alias-label-tertiary, #6b7280)',
  border: 'var(--dsw-alias-border-l2, #d5d9e2)',
  borderStrong: 'var(--dsw-alias-border-l3, #cbd5e1)',
  surface: 'var(--dsw-alias-bg-layer-2, #ffffff)',
  raised: 'var(--dsw-alias-bg-layer-3, #f3f4f6)',
  brand: 'var(--dsw-alias-brand-primary, #2563eb)',
  onBrand: 'var(--dsw-alias-label-primary-foreground, #ffffff)',
  success: 'var(--dsw-alias-state-success-primary, #15803d)',
  warn: 'var(--dsw-alias-state-warn-primary, #b45309)',
  danger: 'var(--dsw-alias-state-error-primary, #b91c1c)',
} as const

const styles = {
  page: { display: 'flex', flexDirection: 'column', gap: 12, height: '100%', minHeight: 0, padding: '12px 16px 16px', boxSizing: 'border-box', color: theme.text } as CSSProperties,
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12, background: theme.surface, color: theme.text } as CSSProperties,
  sticky: { position: 'sticky', top: 0, zIndex: 3, border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12, background: theme.surface, color: theme.text, boxShadow: '0 2px 10px rgba(15, 23, 42, 0.12)' } as CSSProperties,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } as CSSProperties,
  muted: { color: theme.muted, fontSize: 12 } as CSSProperties,
  title: { fontSize: 15, fontWeight: 600, color: theme.text } as CSSProperties,
  main: { display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap', minHeight: 0 } as CSSProperties,
  editorColumn: { flex: '1 1 460px', minWidth: 320, display: 'flex', flexDirection: 'column', gap: 8 } as CSSProperties,
  sideColumn: { flex: '1 1 380px', minWidth: 300, display: 'flex', flexDirection: 'column', gap: 10 } as CSSProperties,
  textarea: { width: '100%', minHeight: 380, resize: 'vertical', boxSizing: 'border-box', padding: 12, lineHeight: 1.8, fontSize: 14, borderRadius: 8, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, fontFamily: 'inherit' } as CSSProperties,
  bar: { display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', padding: '8px 10px', borderRadius: 8, background: theme.raised, color: theme.text } as CSSProperties,
  button: { padding: '6px 14px', borderRadius: 7, border: `1px solid ${theme.borderStrong}`, background: theme.surface, color: theme.text, cursor: 'pointer', fontSize: 13 } as CSSProperties,
  primary: { padding: '7px 16px', borderRadius: 7, border: `1px solid ${theme.brand}`, background: theme.brand, color: theme.onBrand, cursor: 'pointer', fontSize: 13, fontWeight: 600 } as CSSProperties,
  disabled: { opacity: 0.55, cursor: 'not-allowed' } as CSSProperties,
  error: { border: `1px solid ${theme.danger}`, background: 'rgba(220, 38, 38, 0.08)', color: theme.danger, borderRadius: 8, padding: '8px 10px', fontSize: 13 } as CSSProperties,
  notice: { border: `1px solid ${theme.brand}`, background: 'rgba(37, 99, 235, 0.10)', color: theme.brand, borderRadius: 8, padding: '8px 10px', fontSize: 13 } as CSSProperties,
  score: { fontSize: 30, fontWeight: 700, lineHeight: 1.1, color: theme.text } as CSSProperties,
  badge: { display: 'inline-block', padding: '2px 8px', borderRadius: 999, fontSize: 12, border: '1px solid currentColor' } as CSSProperties,
  sectionTitle: { fontSize: 13, fontWeight: 600, margin: '4px 0', color: theme.text } as CSSProperties,
  pre: { whiteSpace: 'pre-wrap', wordBreak: 'break-word', margin: 0, fontFamily: 'inherit', lineHeight: 1.75, fontSize: 13, color: theme.text } as CSSProperties,
  paragraph: { margin: '0 0 8px', lineHeight: 1.9, fontSize: 14, color: theme.text } as CSSProperties,
  mark: { background: '#fde68a', color: '#111827', borderRadius: 3, padding: '0 1px' } as CSSProperties,
  historyRow: { display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: theme.text } as CSSProperties,
  pointRow: { display: 'flex', gap: 6, alignItems: 'flex-start', fontSize: 12, padding: '3px 0', color: theme.text } as CSSProperties,
  suggestion: { border: `1px solid ${theme.border}`, borderRadius: 8, padding: '7px 9px', cursor: 'pointer', background: theme.surface, color: theme.text } as CSSProperties,
} satisfies Record<string, CSSProperties>

export function WritingWorkbench({ sessionId, remote }: WritingWorkbenchProps) {
  const [questions, setQuestions] = useState<QuestionSummary[]>([])
  const [question, setQuestion] = useState<Question | null>(null)
  const [content, setContent] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [running, setRunning] = useState(false)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<'select' | 'saving' | 'judging' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [judge, setJudge] = useState<JudgeResult | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [focusAnchor, setFocusAnchor] = useState<string | null>(null)
  const [historyView, setHistoryView] = useState<HistoryEntry | null>(null)
  const [lastAttemptId, setLastAttemptId] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement | null>(null)
  const draftRef = useRef({ questionId: null as string | null, content: '', elapsedMs: 0, running: false })
  draftRef.current = { questionId: question?.id ?? null, content, elapsedMs, running }

  const words = countWords(content)
  const questionId = question?.id ?? null

  const persistDraft = useCallback(() => {
    const draft = draftRef.current
    if (draft.questionId === null) return
    saveDraft(sessionId, {
      questionId: draft.questionId,
      content: draft.content,
      elapsedMs: draft.elapsedMs,
      running: draft.running,
      updatedAt: Date.now(),
    })
  }, [sessionId])

  const loadHistory = useCallback(
    async (id: string) => {
      const result = await remote.getHistory({ questionId: id })
      if (result.ok) setHistory(result.value.entries)
      else setHistory([])
    },
    [remote],
  )

  const selectQuestion = useCallback(
    async (id: string) => {
      setBusy('select')
      setError(null)
      setNotice(null)
      try {
        const result = await remote.getQuestion({ questionId: id })
        if (!result.ok) {
          setError(remoteErrorText(result.error))
          return
        }
        const draft = loadDraft(sessionId, id)
        setQuestion(result.value)
        setContent(draft?.content ?? '')
        setElapsedMs(draft?.elapsedMs ?? 0)
        setRunning(draft?.running ?? false)
        setJudge(null)
        setFocusAnchor(null)
        setHistoryView(null)
        setLastAttemptId(null)
        saveLastQuestion(sessionId, id)
        await loadHistory(id)
      } finally {
        setBusy(null)
      }
    },
    [loadHistory, remote, sessionId],
  )

  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      const result = await remote.listQuestions()
      if (cancelled) return
      if (!result.ok) {
        setError(remoteErrorText(result.error))
        setLoading(false)
        return
      }
      setQuestions(result.value.questions)
      setLoading(false)
      if (result.value.questions.length > 0) {
        const last = loadLastQuestion(sessionId)
        const target = result.value.questions.find((candidate) => candidate.id === last) ?? result.value.questions[0]
        if (target !== undefined) await selectQuestion(target.id)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [remote, selectQuestion, sessionId])

  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => setElapsedMs((value) => value + 1000), 1000)
    return () => clearInterval(timer)
  }, [running])

  // Persist synchronously on every text change: the previous 2s debounce depended
  // on `elapsedMs`, so the running clock reset it every second and no draft was
  // ever written. Timer/state is refreshed by the interval below and flushed on
  // unmount/pagehide so switching tabs or refreshing never loses the draft.
  useEffect(() => {
    persistDraft()
  }, [content, persistDraft])

  useEffect(() => {
    if (questionId === null) return
    const timer = setInterval(persistDraft, 2000)
    return () => clearInterval(timer)
  }, [questionId, persistDraft])

  useEffect(() => {
    const flush = () => persistDraft()
    globalThis.addEventListener?.('pagehide', flush)
    globalThis.document?.addEventListener?.('visibilitychange', flush)
    return () => {
      flush()
      globalThis.removeEventListener?.('pagehide', flush)
      globalThis.document?.removeEventListener?.('visibilitychange', flush)
    }
  }, [persistDraft])

  useEffect(() => {
    if (focusAnchor === null || previewRef.current === null) return
    const target = previewRef.current.querySelector(`[data-anchor="${focusAnchor}"]`)
    if (target instanceof HTMLElement) target.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [focusAnchor])

  const appendChange = (value: string) => {
    setContent(value)
    if (!running && value.trim().length > 0) setRunning(true)
  }

  const submit = async () => {
    if (question === null || busy !== null) return
    if (words < 50) {
      setError(`作答至少需要 50 字，当前 ${words} 字；继续写作后再提交。`)
      return
    }
    // Unchanged text must not create another Attempt: show the existing scorecard
    // (or judge the existing attempt if it never got one) instead of pushing the
    // history down with duplicates.
    const latest = history[0]
    if (latest !== undefined && latest.attempt.sessionId === sessionId && latest.attempt.contentHash === hashText(content)) {
      setError(null)
      setLastAttemptId(latest.attempt.attemptId)
      if (latest.judge !== null) {
        setHistoryView(null)
        setJudge(latest.judge)
        setFocusAnchor(latest.judge.suggestions[0]?.anchor ?? null)
        setNotice('内容未修改，未新增提交；已展示上一次评分。')
        return
      }
      setNotice('内容未修改，未新增提交；正在补判上一次提交。')
      setBusy('judging')
      try {
        const judged = await remote.judge({ attemptId: latest.attempt.attemptId })
        if (!judged.ok) {
          setError(`判分失败：${remoteErrorText(judged.error)}`)
          return
        }
        setHistoryView(null)
        setJudge(judged.value)
        setFocusAnchor(judged.value.suggestions[0]?.anchor ?? null)
        setNotice(`判分完成：${judged.value.score} 分。`)
        await loadHistory(question.id)
      } finally {
        setBusy(null)
      }
      return
    }
    if (words > question.wordLimit) {
      const confirmed = globalThis.confirm?.(`当前 ${words} 字，超过上限 ${question.wordLimit} 字。仍然提交？`) ?? false
      if (!confirmed) return
    }
    setError(null)
    setNotice(null)
    setBusy('saving')
    try {
      const saved = await remote.saveAttempt({
        sessionId,
        questionId: question.id,
        content,
        elapsedMs,
      })
      if (!saved.ok) {
        setError(`稿件保存失败：${remoteErrorText(saved.error)}`)
        return
      }
      setLastAttemptId(saved.value.attemptId)
      setBusy('judging')
      const judged = await remote.judge({ attemptId: saved.value.attemptId })
      if (!judged.ok) {
        setError(`稿件已保存（${saved.value.attemptId}），判分失败：${remoteErrorText(judged.error)}。可直接重试判分。`)
        await loadHistory(question.id)
        return
      }
      setHistoryView(null)
      setJudge(judged.value)
      setFocusAnchor(judged.value.suggestions[0]?.anchor ?? null)
      setNotice(`判分完成：${judged.value.score} 分。`)
      await loadHistory(question.id)
    } finally {
      setBusy(null)
    }
  }

  const retryJudge = async () => {
    if (lastAttemptId === null || busy !== null) return
    setError(null)
    setBusy('judging')
    try {
      const judged = await remote.judge({ attemptId: lastAttemptId })
      if (!judged.ok) {
        setError(`判分失败：${remoteErrorText(judged.error)}`)
        if (question !== null) await loadHistory(question.id)
        return
      }
      setJudge(judged.value)
      setFocusAnchor(judged.value.suggestions[0]?.anchor ?? null)
      setNotice(`判分完成：${judged.value.score} 分。`)
      if (question !== null) await loadHistory(question.id)
    } finally {
      setBusy(null)
    }
  }

  const preview = useMemo(
    () => renderAnchorPreview(historyView?.content ?? content, focusAnchor),
    [content, focusAnchor, historyView],
  )
  const percent = question === null || question.wordLimit <= 0 ? 0 : words / question.wordLimit
  const quotaColor = percent < 0.8 ? theme.success : percent <= 1 ? theme.warn : theme.danger

  if (loading) {
    return (
      <div style={styles.page}>
        <div style={styles.card}>正在载入题库…</div>
      </div>
    )
  }

  return (
    <div style={styles.page}>
      <div style={styles.sticky}>
        <div style={{ ...styles.row, justifyContent: 'space-between' }}>
          <div style={styles.row}>
            <span style={{ ...styles.badge, color: theme.brand }}>答题</span>
            {question === null ? (
              <span style={styles.muted}>题库为空</span>
            ) : (
              <>
                <span style={styles.title}>{question.type}</span>
                <span style={styles.muted}>{question.topic}</span>
                <span style={styles.muted}>上限 {question.wordLimit} 字</span>
                <span style={styles.muted}>采分点 {question.points.length}</span>
                {question.points.length === 0 ? <span style={{ ...styles.badge, color: theme.warn }}>采分点待抽取</span> : null}
              </>
            )}
          </div>
          <div style={styles.row}>
            <select
              aria-label="选择题库"
              value={question?.id ?? ''}
              disabled={busy !== null || questions.length === 0}
              onChange={(event) => {
                if (event.target.value.length > 0) void selectQuestion(event.target.value)
              }}
              style={{ ...styles.button, minWidth: 180 }}
            >
              {questions.length === 0 ? <option value="">暂无题目</option> : null}
              {questions.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.id}｜{item.type}｜{item.topic}
                </option>
              ))}
            </select>
          </div>
        </div>
        {question !== null ? (
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13 }}>题目材料与作答要求（点击展开）</summary>
            <div style={{ ...styles.pre, marginTop: 8, maxHeight: 220, overflow: 'auto' }}>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>材料</div>
              {question.material}
              <div style={{ fontWeight: 600, margin: '10px 0 4px' }}>作答要求</div>
              {question.requirement}
            </div>
          </details>
        ) : null}
      </div>

      {questions.length === 0 ? (
        <div style={styles.card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>题库为空</div>
          <div style={styles.muted}>
            先让 Agent 调用 <code>train_question_import</code> 导入题目（例如 fixtures/questions 下的合成题），再回到这个 tab 作答。
          </div>
        </div>
      ) : null}

      {error !== null ? (
        <div style={styles.error}>
          {error}
          {lastAttemptId !== null ? (
            <button type="button" style={{ ...styles.button, marginLeft: 10 }} onClick={() => void retryJudge()} disabled={busy !== null}>
              重试判分
            </button>
          ) : null}
        </div>
      ) : null}
      {notice !== null ? <div style={styles.notice}>{notice}</div> : null}

      <div style={styles.main}>
        <div style={styles.editorColumn}>
          <textarea
            aria-label="作答正文"
            style={styles.textarea}
            value={content}
            disabled={question === null}
            placeholder={question === null ? '请先导入题目。' : '在这里写作。段落之间空一行；编辑器不会插入任何 AI 生成的正文。'}
            onChange={(event) => appendChange(event.target.value)}
          />
          <div style={styles.bar}>
            <span style={{ color: quotaColor, fontWeight: 600 }}>{words} / {question?.wordLimit ?? 0} 字</span>
            <span style={{ ...styles.muted, color: quotaColor }}>
              {question === null ? '' : words > question.wordLimit ? `超出 ${words - question.wordLimit} 字` : `距上限 ${question.wordLimit - words} 字`}
            </span>
            <span style={styles.muted}>计时 {formatDuration(elapsedMs)}</span>
            <button type="button" style={styles.button} onClick={() => setRunning((value) => !value)} disabled={question === null}>
              {running ? '暂停' : '继续'}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={{ ...styles.primary, ...(busy !== null || question === null ? styles.disabled : {}) }}
              onClick={() => void submit()}
              disabled={busy !== null || question === null}
            >
              {busy === 'saving' ? '保存中…' : busy === 'judging' ? '判分中…' : '提交判分'}
            </button>
          </div>
          <div style={styles.muted}>
            答题中请勿切换到 AI 对话；本视图只收集你的原稿，不提供对话输入，也不会自动写入正文。
          </div>
        </div>

        <div style={styles.sideColumn}>
          {historyView !== null || focusAnchor !== null ? (
            <div style={styles.card} ref={previewRef}>
              <div style={{ ...styles.row, justifyContent: 'space-between' }}>
                <div style={styles.sectionTitle}>
                  {historyView !== null
                    ? `历史稿件 · 第 ${historyView.attempt.attemptNo} 次提交`
                    : `正文定位 · ${focusAnchor ?? ''}`}
                </div>
                {historyView !== null ? (
                  <button
                    type="button"
                    style={styles.button}
                    onClick={() => {
                      setHistoryView(null)
                      setFocusAnchor(null)
                    }}
                  >
                    返回当前正文
                  </button>
                ) : null}
              </div>
              {historyView !== null ? (
                <div style={styles.muted}>
                  只读 · {historyView.attempt.wordCount} 字
                  {focusAnchor === null ? '' : ` · 锚点 ${focusAnchor}`} · 可与左侧当前正文对照
                </div>
              ) : null}
              {preview}
            </div>
          ) : null}

          {judge !== null ? <ScoreCard judge={judge} onFocus={setFocusAnchor} /> : (
            <div style={styles.card}>
              <div style={styles.sectionTitle}>评分卡</div>
              <div style={styles.muted}>
                提交后在这里显示总分、五维、采分点矩阵、缺失要素和带锚点的建议。评分只做诊断，不返回成稿。
              </div>
            </div>
          )}

          <div style={styles.card}>
            <div style={{ ...styles.row, justifyContent: 'space-between' }}>
              <div style={styles.sectionTitle}>历史 Attempt</div>
              {history.length > 0 ? <span style={styles.muted}>最近 {history.length} 次 · 可滚动</span> : null}
            </div>
            {history.length === 0 ? (
              <div style={styles.muted}>本题还没有提交记录。</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 200, overflowY: 'auto', marginTop: 4 }}>
                {history.map((entry) => (
                  <div
                    key={entry.attempt.attemptId}
                    style={styles.historyRow}
                    onClick={() => {
                      setHistoryView(entry)
                      if (entry.judge !== null) {
                        setJudge(entry.judge)
                        setFocusAnchor(entry.judge.suggestions[0]?.anchor ?? null)
                        setNotice(`正在查看历史评分（第 ${entry.attempt.attemptNo} 次提交）。`)
                      } else {
                        setJudge(null)
                        setFocusAnchor(null)
                        setNotice(`正在查看第 ${entry.attempt.attemptNo} 次提交的稿件（尚未判分）。`)
                      }
                    }}
                  >
                    <span>第 {entry.attempt.attemptNo} 次 · {entry.attempt.wordCount} 字</span>
                    <span style={{ fontWeight: 600 }}>{entry.judge === null ? '未判分' : `${entry.judge.score} 分`}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function ScoreCard({ judge, onFocus }: { judge: JudgeResult; onFocus: (anchor: string) => void }) {
  return (
    <div style={styles.card}>
      <div style={{ ...styles.row, justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <div>
          <div style={styles.muted}>总分</div>
          <div style={{ ...styles.score, color: judge.pass ? theme.success : theme.text }}>{judge.score}</div>
        </div>
        <div style={styles.row}>
          <span style={{ ...styles.badge, color: judge.pass ? theme.success : theme.warn }}>
            {judge.pass ? '达标' : '未达标'}
          </span>
          <span style={{ ...styles.badge, color: theme.muted }}>{judge.thresholdState === 'calibrating' ? '校准中' : '已校准'}</span>
          {judge.unstable ? <span style={{ ...styles.badge, color: theme.danger }}>波动较大</span> : null}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <DimensionBar label="采分点覆盖" value={judge.dims.coverage} />
        <DimensionBar label="链条完整" value={judge.dims.chain} />
        <DimensionBar label="六要素" value={judge.dims.elements} />
        <DimensionBar label="语言格式" value={judge.dims.language} />
        <DimensionBar label="材料贴合" value={judge.dims.material} />
      </div>

      <div style={styles.sectionTitle}>采分点矩阵</div>
      {judge.points.length === 0 ? <div style={styles.muted}>本题暂无采分点。</div> : null}
      {judge.points.map((point) => (
        <div key={point.id} style={styles.pointRow}>
          <span style={{ ...styles.badge, color: point.status === 'hit' ? theme.success : point.status === 'partial' ? theme.warn : theme.danger, flex: '0 0 auto' }}>
            {point.status === 'hit' ? '命中' : point.status === 'partial' ? '部分' : '未命中'}
          </span>
          <span>{point.id}{point.anchor === undefined ? '' : ` · ${point.anchor}`}</span>
        </div>
      ))}

      <div style={styles.sectionTitle}>缺失与问题</div>
      <ChipList label="缺失环节" values={judge.missingLinks} />
      <ChipList label="缺失材料点" values={judge.missingPoints} />
      <ChipList label="格式问题" values={judge.formatIssues} />
      {judge.emptyPhrases.length > 0 ? (
        <div style={styles.muted}>
          空话句：{judge.emptyPhrases.map((phrase) => `${phrase.anchor} ${phrase.text}`).join('；')}
        </div>
      ) : null}

      <div style={styles.sectionTitle}>改进方向（≤5 条）</div>
      {judge.suggestions.length === 0 ? <div style={styles.muted}>没有可定位的建议。</div> : null}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {judge.suggestions.map((suggestion) => (
          <div key={suggestion.id} style={styles.suggestion} onClick={() => onFocus(suggestion.anchor)}>
            <div style={{ ...styles.row, justifyContent: 'space-between' }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>{suggestion.anchor} · {suggestion.issueType}</span>
              <span style={{ ...styles.badge, color: suggestion.impact === 'high' ? theme.danger : suggestion.impact === 'mid' ? theme.warn : theme.muted }}>
                {suggestion.impact === 'high' ? '高影响' : suggestion.impact === 'mid' ? '中影响' : '低影响'}
              </span>
            </div>
            <div style={{ fontSize: 13, marginTop: 4 }}>{suggestion.direction}</div>
            {suggestion.evidence.length > 0 ? <div style={{ ...styles.muted, marginTop: 3 }}>依据：{suggestion.evidence}</div> : null}
            {suggestion.guard === true ? <div style={{ ...styles.muted, color: theme.warn, marginTop: 3 }}>已按训练规则收敛</div> : null}
          </div>
        ))}
      </div>

      {judge.guardFlags.length > 0 ? (
        <div style={{ ...styles.notice, marginTop: 10 }}>{judge.guardFlags.join('；')}</div>
      ) : null}
      <div style={{ ...styles.muted, marginTop: 8 }}>
        token：输入 {judge.tokenUsage.input} / 输出 {judge.tokenUsage.output} · 模型 {judge.modelId} · 评分标准 {judge.weightsVersion}
      </div>
    </div>
  )
}

function DimensionBar({ label, value }: { label: string; value: number }) {
  const normalized = Math.max(0, Math.min(100, value))
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
      <span style={{ ...styles.muted, width: 76, flex: '0 0 auto' }}>{label}</span>
      <div style={{ flex: 1, height: 7, borderRadius: 999, background: theme.raised, overflow: 'hidden' }}>
        <div style={{ width: `${normalized}%`, height: '100%', background: normalized >= 85 ? theme.success : normalized >= 60 ? theme.warn : theme.danger }} />
      </div>
      <span style={{ ...styles.muted, width: 30, textAlign: 'right' }}>{Math.round(value)}</span>
    </div>
  )
}

function ChipList({ label, values }: { label: string; values: readonly string[] }) {
  if (values.length === 0) return null
  return (
    <div style={{ ...styles.muted, marginBottom: 4 }}>
      {label}：{values.join('、')}
    </div>
  )
}

function renderAnchorPreview(content: string, focusAnchor: string | null) {
  const paragraphs = splitParagraphs(content)
  if (paragraphs.length === 0) return <div style={styles.muted}>正文为空。</div>
  return (
    <div style={{ maxHeight: 260, overflow: 'auto', marginTop: 6 }}>
      {paragraphs.map((paragraph) => (
        <p key={paragraph.index} style={styles.paragraph}>
          {splitSentences(paragraph).map((sentence) => {
            const anchor = `${sentence.paragraph}:${sentence.index}`
            const active = anchor === focusAnchor
            return (
              <span key={anchor} data-anchor={anchor} style={active ? styles.mark : undefined}>
                {sentence.text}
              </span>
            )
          })}
        </p>
      ))}
    </div>
  )
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
