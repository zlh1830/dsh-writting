import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { CoachConfigResult, CoachProbeResult } from '@local/dsh-train-core'
import { remoteErrorText, type TrainRemoteNamespace } from './remote.js'

const theme = {
  text: 'var(--dsw-alias-label-primary, inherit)',
  muted: 'var(--dsw-alias-label-tertiary, #6b7280)',
  border: 'var(--dsw-alias-border-l2, #d5d9e2)',
  surface: 'var(--dsw-alias-bg-layer-2, #ffffff)',
  success: 'var(--dsw-alias-state-success-primary, #15803d)',
  danger: 'var(--dsw-alias-state-error-primary, #b91c1c)',
} as const

const styles = {
  card: { border: `1px solid ${theme.border}`, borderRadius: 10, padding: 12, background: theme.surface, color: theme.text, fontSize: 13 } as CSSProperties,
  row: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' } as CSSProperties,
  muted: { color: theme.muted, fontSize: 12, lineHeight: 1.6 } as CSSProperties,
  button: { padding: '5px 12px', borderRadius: 6, border: `1px solid ${theme.border}`, background: 'transparent', color: theme.text, cursor: 'pointer', fontSize: 12 } as CSSProperties,
} satisfies Record<string, CSSProperties>

export function CoachSettings({ remote }: { remote: TrainRemoteNamespace }) {
  const [config, setConfig] = useState<CoachConfigResult | null>(null)
  const [probe, setProbe] = useState<CoachProbeResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const result = await remote.coachConfig()
      if (cancelled) return
      if (result.ok) setConfig(result.value)
      else setError(remoteErrorText(result.error))
    })()
    return () => {
      cancelled = true
    }
  }, [remote])

  const test = async () => {
    setBusy(true)
    setError(null)
    try {
      const result = await remote.coachProbe()
      if (result.ok) setProbe(result.value)
      else setError(remoteErrorText(result.error))
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.row}>
        <div>
          <div style={{ fontWeight: 600 }}>写作训练 · 本地教练</div>
          <div style={styles.muted}>实时链条识别是可选项；没有本地模型时自动使用规则匹配，不影响写作与云端判分。</div>
        </div>
        <button type="button" style={styles.button} onClick={() => void test()} disabled={busy}>
          {busy ? '测试中…' : '测试本地模型'}
        </button>
      </div>

      {config === null ? (
        <div style={{ ...styles.muted, marginTop: 8 }}>{error ?? '正在读取教练配置…'}</div>
      ) : (
        <div style={{ marginTop: 8, display: 'grid', gap: 3 }}>
          <div>provider：<code>{config.provider}</code> · model：<code>{config.model}</code></div>
          <div>模式：{config.mode} · 链条卡：{config.chainCount} 张</div>
          <div style={{ color: config.providerAvailable ? theme.success : theme.muted }}>
            {config.providerAvailable ? '本地 provider 已挂载' : '未检测到本地 provider，使用规则匹配'}
          </div>
        </div>
      )}

      {probe !== null ? (
        <div style={{ ...styles.muted, marginTop: 8, color: probe.ok ? theme.success : theme.danger }}>
          {probe.ok
            ? `连通测试通过：${probe.latencyMs}ms · ${probe.provider}/${probe.model}`
            : `连通测试失败：${probe.error ?? 'unknown'}`}
        </div>
      ) : null}
      {error !== null && config !== null ? <div style={{ ...styles.muted, color: theme.danger, marginTop: 6 }}>{error}</div> : null}
      <div style={{ ...styles.muted, marginTop: 8 }}>
        本地 provider 在 DSH「设置 → 模型」添加 OpenAI-compatible 路由；迁移与真模型验收见本地 private 手册。
      </div>
    </div>
  )
}
