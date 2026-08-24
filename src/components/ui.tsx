import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { addDaysCN, addMonthsCN, monthOf, todayCN } from '@/lib/date'

export type ToastType = 'info' | 'ok' | 'err'

/** 轻提示 */
export function useToast() {
  const [msg, setMsg] = useState<{ text: string; type: ToastType } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  const show = useCallback((text: string, type: ToastType = 'info') => {
    setMsg({ text, type })
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setMsg(null), 2800)
  }, [])

  const node = msg ? (
    <div className={`toast show ${msg.type === 'info' ? '' : msg.type}`}>{msg.text}</div>
  ) : null

  return { show, node }
}

/** 弹窗 */
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/** 骨架屏 */
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="skeleton sk-row"
          style={{ width: `${Math.max(40, 92 - i * 14)}%` }}
        />
      ))}
    </div>
  )
}

/** 空状态 */
export function Empty({ text }: { text: string }) {
  return <div className="empty">{text}</div>
}

/** 状态徽章 */
export function Badge({
  kind,
  children,
}: {
  kind: 'ok' | 'warn' | 'danger' | 'gold'
  children: ReactNode
}) {
  return <span className={`badge badge-${kind}`}>{children}</span>
}

/** 时间区间选择：快捷范围下拉 + 起止日期(或月份)，onChange 返回 [start, end] */
export function DateRange({
  mode = 'day',
  start,
  end,
  onChange,
}: {
  mode?: 'day' | 'month'
  start: string
  end: string
  onChange: (start: string, end: string) => void
}) {
  const today = todayCN()
  const presets =
    mode === 'month'
      ? [
          { label: '近3月', s: monthOf(addMonthsCN(today, -2)), e: monthOf(today) },
          { label: '近6月', s: monthOf(addMonthsCN(today, -5)), e: monthOf(today) },
          { label: '近12月', s: monthOf(addMonthsCN(today, -11)), e: monthOf(today) },
          { label: '全部', s: '1970-01', e: '2099-12' },
        ]
      : [
          { label: '近3天', s: addDaysCN(today, -2), e: today },
          { label: '近7天', s: addDaysCN(today, -6), e: today },
          { label: '近30天', s: addDaysCN(today, -29), e: today },
          { label: '全部', s: '1970-01-01', e: '2099-12-31' },
        ]
  const active = presets.find((p) => p.s === start && p.e === end)
  return (
    <div className="date-range">
      <select
        className="select select-sm"
        value={active?.label ?? ''}
        onChange={(e) => {
          const p = presets.find((x) => x.label === e.target.value)
          if (p) onChange(p.s, p.e)
        }}
      >
        <option value="">自定义</option>
        {presets.map((p) => (
          <option key={p.label} value={p.label}>
            {p.label}
          </option>
        ))}
      </select>
      <input
        type={mode === 'month' ? 'month' : 'date'}
        className="input input-sm"
        value={start}
        onChange={(e) => onChange(e.target.value, end)}
      />
      <span className="muted">~</span>
      <input
        type={mode === 'month' ? 'month' : 'date'}
        className="input input-sm"
        value={end}
        onChange={(e) => onChange(start, e.target.value)}
      />
    </div>
  )
}
