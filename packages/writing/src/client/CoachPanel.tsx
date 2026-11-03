import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  countWords,
  selectCoachParagraph,
  type ChainCard,
  type ChainSnapshot,
  type LinkState,
  type Question,
} from '@local/dsh-train-core'
import { remoteErrorText, type TrainRemoteNamespace } from './remote.js'
import { CoachSettings } from './CoachSettings.js'

export interface CoachPanelProps {
  sessionId: string
  question: Question
  remote: TrainRemoteNamespace
  content: string
  textareaRef: { current: HTMLTextAreaElement | null }
  disabled: boolean
  onInsert: (link: string) => void
  onClear: () => void
}

const theme = {
  text: 'var(--dsw-alias-label-primary, inherit)',
  muted: 'var(--dsw-alias-label-tertiary, #6b7280)',
  border: 'var(--dsw-alias-border-l2, #d5d9e2)',
  surface: 'var(--dsw-alias-bg-layer-2, #ffffff)',
  raised: 'var(--dsw-alias-bg-layer-3, #f3f4f6)',
  brand: 'var(--dsw-alias-brand-primary, #2563eb)',
  success: 'var(--dsw-alias-state-success-primary, #15803d)',
  warn: 'var(--dsw-alias-state-warn-primary, #b45309)',
  danger: 'var(--dsw-alias-state-error-primary, #b91c1c)',
} as const

const styles = {
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12, background: theme.surface, color: theme.text } as CSSProperties,
  row: { display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' } as CSSProperties,
  title: { fontSize: 13, fontWeight: 600 } as CSSProperties,
  muted: { color: theme.muted, fontSize: 12, lineHeight: 1.5 } as CSSProperties,
  badge: { display: 'inline-block', padding: '1px 7px', borderRadius: 999, border: '1px solid currentColor', fontSize: 11 } as CSSProperties,
  button: { padding: '4px 10px', borderRadius: 6, border: `1px solid ${theme.border}`, background: theme.surface, color: theme.text, cursor: 'pointer', fontSize: 12 } as CSSProperties,
  ringWrap: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 } as CSSProperties,
  ring: { width: 62, height: 62, borderRadius: '50%', display: 'grid', placeItems: 'center', flex: '0 0 auto' } as CSSProperties,
  ringInner: { width: 46, height: 46, borderRadius: '50%', background: theme.surface, display: 'grid', placeItems: 'center', fontSize: 12, fontWeight: 700, color: theme.text } as CSSProperties,
  linkCard: { display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'left', width: '100%', padding: '5px 8px', borderRadius: 7, border: `1px solid ${theme.border}`, background: theme.raised, color: theme.text, cursor: 'pointer', fontSize: 12 } as CSSProperties,
  linkList: { display: 'flex', flexDirection: 'column', gap: 5, marginTop: 8 } as CSSProperties,
  section: { marginTop: 10, paddingTop: 8, borderTop: `1px solid ${theme.border}` } as CSSProperties,
} satisfies Record<string, CSSProperties>

export function CoachPanel({ sessionId, question, remote, content, textareaRef, disabled, onInsert, onClear }: CoachPanelProps) {
  const [chain, setChain] = useState<ChainCard | null>(null)
  const [snapshot, setSnapshot] = useState<ChainSnapshot | null>(null)
  const [providerAvailable, setProviderAvailable] = useState(false)
  const [mode, setMode] = useState('auto')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(() => readCollapsed(sessionId))
  const [showConfig, setShowConfig] = useState(false)

  const contentRef = useRef(content)
  contentRef.current = content
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const inflightRef = useRef(false)
  const pendingRef = useRef(false)
  const lastScanRef = useRef(0)
  const scannedWordsRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setChain(null)
    setSnapshot(null)
    setProviderAvailable(false)
    setBusy(false)
    void (async () => {
      await remote.coachReset({ sessionId, questionId: question.id })
      const result = await remote.getChain({ sessionId, questionId: question.id })
      if (cancelled) return
      if (result.ok) {
        setChain(result.value.chain)
        setSnapshot(result.value.snapshot)
        setProviderAvailable(result.value.providerAvailable)
        setMode(result.value.mode)
        scannedWordsRef.current = countWords(contentRef.current)
        lastScanRef.current = Date.now()
      } else {
        setError(remoteErrorText(result.error))
      }
      setLoading(false)
    })()
    return () => {
      cancelled = true
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = null
      abortRef.current?.abort()
      abortRef.current = null
      inflightRef.current = false
      pendingRef.current = false
    }
  }, [question.id, remote, sessionId])

  useEffect(() => {
    if (!disabled) return
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    abortRef.current?.abort()
    abortRef.current = null
    inflightRef.current = false
    pendingRef.current = false
    setBusy(false)
  }, [disabled])

  const runScan = useCallback(
    async (forceModel: boolean) => {
      if (disabled || chain === null) return
      if (inflightRef.current) {
        pendingRef.current = true
        return
      }
      const current = contentRef.current
      const caret = textareaRef.current?.selectionStart ?? current.length
      const paragraph = selectCoachParagraph(current, caret, 1_200)
      if (paragraph === null) return
      inflightRef.current = true
      setBusy(true)
      const controller = new AbortController()
      abortRef.current = controller
      try {
        const result = await remote.coachScan(
          {
            sessionId,
            questionId: question.id,
            content: current,
            paragraph: paragraph.text,
            paragraphIndex: paragraph.index,
            ...(forceModel ? { forceModel: true } : {}),
          },
          controller.signal,
        )
        if (result.ok) {
          setSnapshot(result.value)
          setError(null)
          scannedWordsRef.current = countWords(current)
          lastScanRef.current = Date.now()
        } else {
          setError(remoteErrorText(result.error))
        }
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
      } finally {
        inflightRef.current = false
        abortRef.current = null
        setBusy(false)
        if (pendingRef.current) {
          pendingRef.current = false
          setTimeout(() => void runScan(forceModel), 0)
        }
      }
    },
    [chain, disabled, question.id, remote, sessionId, textareaRef],
  )

  useEffect(() => {
    if (disabled || chain === null || loading) return
    const now = Date.now()
    const words = countWords(content)
    const chars = words - scannedWordsRef.current
    if (words < 20) return
    if (timerRef.current !== null) clearTimeout(timerRef.current)
    const delay = chars >= 50 ? Math.max(250, 2_000 - (now - lastScanRef.current)) : 3_000
    timerRef.current = setTimeout(() => {
      void runScan(false)
    }, delay)
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
    }
  }, [chain, content, disabled, loading, runScan])

  const manualCheck = async (forceModel: boolean) => {
    if (chain === null || busy) return
    setBusy(true)
    setError(null)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const result = await remote.coachCheck(
        {
          sessionId,
          questionId: question.id,
          content: contentRef.current,
          ...(forceModel ? { forceModel: true } : {}),
        },
        controller.signal,
      )
      if (result.ok) {
        setSnapshot(result.value)
        setError(null)
        scannedWordsRef.current = countWords(contentRef.current)
        lastScanRef.current = Date.now()
      } else {
        setError(remoteErrorText(result.error))
      }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      abortRef.current = null
      setBusy(false)
    }
  }

  const toggle = () => {
    setCollapsed((value) => {
      const next = !value
      writeCollapsed(sessionId, next)
      return next
    })
  }

  if (loading) return <div style={styles.card}>正在载入链条卡…</div>
  if (error !== null && chain === null) {
    return (
      <div style={styles.card}>
        <div style={styles.title}>链条教练</div>
        <div style={{ ...styles.muted, color: theme.danger, marginTop: 6 }}>{error}</div>
      </div>
    )
  }
  if (chain === null) {
    return (
      <div style={styles.card}>
        <div style={styles.title}>链条教练</div>
        <div style={{ ...styles.muted, marginTop: 6 }}>该题型暂无链条卡；可在 <code>$DSH_HOME/train/chains</code> 放置链条 Markdown 后重启。</div>
      </div>
    )
  }

  const source = snapshot?.source ?? 'rules'
  const sourceLabel = source === 'model' ? '本地模型' : source === 'degraded' ? '降级' : providerAvailable ? '规则匹配' : '规则匹配 · 未配置本地模型'
  const sourceColor = source === 'model' ? theme.success : source === 'degraded' ? theme.danger : theme.warn
  const coverage = snapshot?.coverage ?? 0
  const states = snapshot?.states ?? {}
  const missing = chain.required.filter((link) => (states[link] ?? 'missing') !== 'covered')
  const coveredCount = chain.required.length - missing.length
  const uncertainCount = chain.required.filter((link) => states[link] === 'uncertain').length

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <div style={styles.row}>
          <span style={styles.title}>链条教练</span>
          <span style={{ ...styles.badge, color: sourceColor }}>{sourceLabel}</span>
          {snapshot?.discarded === true ? <span style={{ ...styles.badge, color: theme.warn }}>波动已拦截</span> : null}
        </div>
        <button type="button" style={styles.button} onClick={toggle}>{collapsed ? '展开' : '收起'}</button>
      </div>

      {collapsed ? null : (
        <>
          <div style={styles.ringWrap}>
            <div style={{ ...styles.ring, background: `conic-gradient(${theme.brand} ${coverage * 3.6}deg, ${theme.raised} 0deg)` }}>
              <div style={styles.ringInner}>{coverage}%</div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 12 }}>
                必答覆盖 <strong>{coveredCount}/{chain.required.length}</strong>
                {uncertainCount > 0 ? ` · 不确定 ${uncertainCount}` : ''}
              </div>
              <div style={styles.muted}>
                {snapshot === null ? '等待首次识别' : `更新 ${formatAgo(snapshot.checkedAt)} · ${snapshot.latencyMs}ms`}
                {snapshot !== null && snapshot.failures > 0 ? ` · 失败 ${snapshot.failures}` : ''}
              </div>
              {snapshot?.degradedReason !== undefined ? <div style={{ ...styles.muted, color: theme.danger }}>{snapshot.degradedReason}</div> : null}
            </div>
          </div>

          <div style={{ ...styles.linkList, maxHeight: 260, overflowY: 'auto' }}>
            {missing.length === 0 ? (
              <div style={{ ...styles.muted, color: theme.success }}>必答环节已覆盖。可继续写作或检查链条。</div>
            ) : (
              missing.map((link) => {
                const state: LinkState = states[link] ?? 'missing'
                return (
                  <button key={link} type="button" style={styles.linkCard} onClick={() => onInsert(link)} title="插入待补标记">
                    <span style={{ fontWeight: 600, color: state === 'uncertain' ? theme.warn : theme.danger }}>
                      {state === 'uncertain' ? '待确认' : '待补'} · {link}
                    </span>
                    <span style={styles.muted}>{chain.anchors[link]?.slice(0, 3).join('、') ?? '点击插入【待补】标记'}</span>
                  </button>
                )
              })
            )}
          </div>

          {chain.optional.length > 0 ? (
            <details style={styles.section}>
              <summary style={{ ...styles.muted, cursor: 'pointer' }}>可选环节（{chain.optional.length}）</summary>
              <div style={{ ...styles.muted, marginTop: 4 }}>
                {chain.optional.map((link) => `${link}${states[link] === 'covered' ? '✓' : states[link] === 'uncertain' ? '?' : '·'}`).join('  ')}
              </div>
            </details>
          ) : null}

          <div style={{ ...styles.row, marginTop: 10, justifyContent: 'flex-start' }}>
            <button type="button" style={styles.button} onClick={() => void manualCheck(false)} disabled={busy || disabled}>
              {busy ? '识别中…' : '检查链条'}
            </button>
            {providerAvailable || (snapshot?.failures ?? 0) > 0 ? (
              <button type="button" style={styles.button} onClick={() => void manualCheck(true)} disabled={busy || disabled}>
                重试本地模型
              </button>
            ) : null}
            <button type="button" style={styles.button} onClick={onClear} disabled={disabled}>
              清除待补标记
            </button>
            <button type="button" style={styles.button} onClick={() => setShowConfig((value) => !value)}>
              {showConfig ? '收起配置' : '配置本地模型'}
            </button>
          </div>

          {showConfig ? (
            <div style={{ marginTop: 10 }}>
              <CoachSettings remote={remote} />
            </div>
          ) : null}

          {disabled ? <div style={{ ...styles.muted, marginTop: 6 }}>历史回看中，实时教练已暂停。</div> : null}
          {error !== null ? <div style={{ ...styles.muted, color: theme.danger, marginTop: 6 }}>{error}</div> : null}
          <div style={{ ...styles.muted, marginTop: 6 }}>
            {mode === 'auto' ? '自动' : mode === 'rules' ? '仅规则' : '仅模型'} · 只发送当前段落，不落正文
          </div>
        </>
      )}
    </div>
  )
}

function formatAgo(timestamp: number): string {
  if (timestamp <= 0) return '未更新'
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000))
  if (seconds < 5) return '刚刚'
  if (seconds < 60) return `${seconds}s 前`
  return `${Math.floor(seconds / 60)}m 前`
}

function readCollapsed(sessionId: string): boolean {
  try {
    return globalThis.localStorage?.getItem(`dsh.train.coach.v1.${sessionId}`) === '1'
  } catch {
    return false
  }
}

function writeCollapsed(sessionId: string, collapsed: boolean): void {
  try {
    globalThis.localStorage?.setItem(`dsh.train.coach.v1.${sessionId}`, collapsed ? '1' : '0')
  } catch {
    // ignore
  }
}
