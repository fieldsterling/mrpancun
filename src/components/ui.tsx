import { useCallback, useRef, useState } from 'react'
import type { ReactNode } from 'react'

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
