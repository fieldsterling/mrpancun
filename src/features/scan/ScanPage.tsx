import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { listProducts } from '@/lib/localDb'
import { buildProductIndex, buildSystemMap, reconcile } from '@/lib/reconcile'
import { confirmInventory } from '@/lib/confirm'
import { todayCN } from '@/lib/date'
import type { DiffRow, Product } from '@/lib/types'
import { Badge, Empty, Modal, Skeleton, useToast } from '@/components/ui'

interface Props {
  store: string
  onStoresChanged: () => void
}

type Flash = 'ok' | 'warn' | 'err' | null

export default function ScanPage({ store }: Props) {
  const { show, node } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null) // null = 加载中（骨架屏）
  const [actualMap, setActualMap] = useState<Map<string, number>>(new Map())
  const [query, setQuery] = useState('')
  const [flash, setFlash] = useState<Flash>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [adjustStock, setAdjustStock] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const businessDate = todayCN()

  const productIndex = useMemo(() => buildProductIndex(products ?? []), [products])
  const systemMap = useMemo(() => buildSystemMap(products ?? []), [products])
  const diffRows = useMemo(
    () => reconcile({ systemMap, actualMap, productIndex }),
    [systemMap, actualMap, productIndex],
  )

  const load = useCallback(async () => {
    setProducts(null)
    const list = await listProducts(store)
    setProducts(list)
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  // 点击页面任意处后自动重新聚焦扫码框
  useEffect(() => {
    const onDown = () => inputRef.current?.focus()
    window.addEventListener('click', onDown)
    return () => window.removeEventListener('click', onDown)
  }, [])

  const flashOnce = (f: Flash) => {
    setFlash(f)
    window.setTimeout(() => setFlash(null), 320)
  }

  const bump = (code: string) => {
    setActualMap((prev) => {
      const next = new Map(prev)
      next.set(code, (next.get(code) ?? 0) + 1)
      return next
    })
  }

  const handleScan = () => {
    const code = query.trim()
    setQuery('')
    if (!code) return
    bump(code)
    flashOnce(productIndex.has(code) ? 'ok' : 'warn')
  }

  const setQty = (code: string, raw: number) => {
    const v = Math.max(0, Math.round(raw * 1000) / 1000)
    setActualMap((prev) => {
      const next = new Map(prev)
      if (v === 0) next.delete(code)
      else next.set(code, v)
      return next
    })
  }

  const clearActual = () => {
    if (actualMap.size === 0) return
    setActualMap(new Map())
    show('已清空本次实盘数据', 'info')
  }

  // TXT 解析：每行编号（+1）或 编号,数量
  const importTxt = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    const next = new Map(actualMap)
    let count = 0
    for (const line of lines) {
      const parts = line.split(/[\t,，\s]+/).filter(Boolean)
      if (parts.length === 0) continue
      const code = parts[0]
      const qty = parts.length > 1 ? Number(parts[1]) : 1
      if (!code) continue
      next.set(code, (next.get(code) ?? 0) + (Number.isFinite(qty) ? qty : 1))
      count++
    }
    setActualMap(next)
    show(`TXT 导入 ${count} 条`, 'ok')
  }

  // Excel 解析：产品编号 / 数量 / 店名（无店名则默认当前门店）
  const importExcel = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer())
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    const next = new Map(actualMap)
    let count = 0
    for (const r of rows) {
      const code = String(r['产品编号'] ?? r['编号'] ?? r['code'] ?? '').trim()
      if (!code) continue
      const storeName = String(r['店名'] ?? r['store'] ?? '').trim()
      if (storeName && storeName !== store) continue // 仅统计当前门店
      const qty = Number(r['数量'] ?? r['qty'] ?? r['数量'])
      next.set(code, (next.get(code) ?? 0) + (Number.isFinite(qty) ? qty : 1))
      count++
    }
    setActualMap(next)
    show(`Excel 导入 ${count} 条`, 'ok')
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const name = f.name.toLowerCase()
    try {
      if (name.endsWith('.txt') || name.endsWith('.csv')) {
        importTxt(await f.text())
      } else if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        await importExcel(f)
      } else {
        show('不支持的文件类型，仅支持 TXT / CSV / Excel', 'err')
      }
    } catch (e) {
      show(`导入失败：${(e as Error).message}`, 'err')
    }
  }

  const onConfirm = async () => {
    setConfirming(true)
    try {
      const result = await confirmInventory({ store, businessDate, actualMap, adjustStock })
      setShowConfirm(false)
      setActualMap(new Map())
      await load()
      show(
        `已确认盘存：${result.snapshotCount} 项，差异 ${result.diffCount} 项` +
          (adjustStock ? `，生成流水 ${result.journalCount} 条` : ''),
        'ok',
      )
    } catch (e) {
      show(`盘存确认失败：${(e as Error).message}`, 'err')
    } finally {
      setConfirming(false)
    }
  }

  const scannedCount = actualMap.size
  const scannedTotal = [...actualMap.values()].reduce((a, b) => a + b, 0)
  const unknownCount = [...actualMap.keys()].filter((c) => !productIndex.has(c)).length
  const diffCount = diffRows.filter((d) => d.status !== 'MATCH').length

  const statusBadge = (d: DiffRow) => {
    if (d.status === 'MATCH') return <Badge kind="ok">一致</Badge>
    if (d.status === 'SYSTEM_MISSING') return <Badge kind="danger">盘亏</Badge>
    return <Badge kind="warn">盘盈</Badge>
  }

  return (
    <>
      <section className="card">
        <div className="card-title">扫码盘存 · {businessDate}</div>
        <input
          ref={inputRef}
          className={`scan-input ${flash ? `flash-${flash}` : ''}`}
          placeholder="扫描或输入产品编号，回车即计数（可连接扫码枪）"
          value={query}
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleScan()
          }}
        />
        <div className="row mt">
          <button className="btn" onClick={() => inputRef.current?.focus()}>
            重新聚焦
          </button>
          <label className="btn">
            导入 TXT / Excel
            <input
              type="file"
              accept=".txt,.csv,.xlsx,.xls"
              style={{ display: 'none' }}
              onChange={(e) => {
                void onFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </label>
          <button className="btn btn-danger btn-sm" onClick={clearActual} disabled={scannedCount === 0}>
            清空本次
          </button>
        </div>
      </section>

      <section className="card">
        <div className="stats">
          <div className="stat">
            <div className="num">{scannedCount}</div>
            <div className="lbl">已盘种类</div>
          </div>
          <div className="stat">
            <div className="num">{scannedTotal}</div>
            <div className="lbl">已盘总数量</div>
          </div>
          <div className="stat">
            <div className="num">{systemMap.size}</div>
            <div className="lbl">系统库存种类</div>
          </div>
          <div className="stat">
            <div className="num" style={{ color: diffCount > 0 ? 'var(--warn)' : 'var(--gold-deep)' }}>
              {diffCount}
            </div>
            <div className="lbl">差异项</div>
          </div>
          {unknownCount > 0 && (
            <div className="stat">
              <div className="num" style={{ color: 'var(--warn)' }}>
                {unknownCount}
              </div>
              <div className="lbl">库外未知编号</div>
            </div>
          )}
        </div>
      </section>

      <section className="card">
        <div className="card-title">差异比对结果</div>
        {products === null ? (
          <Skeleton lines={5} />
        ) : diffRows.length === 0 ? (
          <Empty text="暂无数据，请先扫码或导入" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>类别</th>
                  <th className="t-num">系统数量</th>
                  <th>实盘数量</th>
                  <th className="t-num">差异</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {diffRows.map((d) => (
                  <tr key={d.code}>
                    <td>
                      {d.code}
                      {!productIndex.has(d.code) && <div className="unknown-code">库外</div>}
                    </td>
                    <td>{d.name || <span className="muted">—</span>}</td>
                    <td>{d.category || <span className="muted">—</span>}</td>
                    <td className="t-num">{d.systemQty}</td>
                    <td>
                      <span className="qty-ctl">
                        <button onClick={() => setQty(d.code, (actualMap.get(d.code) ?? 0) - 1)}>
                          −
                        </button>
                        <input
                          type="number"
                          value={actualMap.get(d.code) ?? 0}
                          onChange={(e) => setQty(d.code, Number(e.target.value))}
                        />
                        <button onClick={() => setQty(d.code, (actualMap.get(d.code) ?? 0) + 1)}>
                          +
                        </button>
                      </span>
                    </td>
                    <td
                      className="t-num"
                      style={{
                        color: d.diff === 0 ? 'var(--text-muted)' : d.diff > 0 ? 'var(--warn)' : 'var(--danger)',
                        fontWeight: 700,
                      }}
                    >
                      {d.diff > 0 ? `+${d.diff}` : d.diff}
                    </td>
                    <td>{statusBadge(d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="row mt">
          <button
            className="btn btn-primary btn-lg"
            disabled={scannedCount === 0}
            onClick={() => setShowConfirm(true)}
          >
            确认盘存
          </button>
        </div>
      </section>

      {showConfirm && (
        <Modal title={`确认盘存 · ${businessDate}`} onClose={() => setShowConfirm(false)}>
          <div className="muted mb">
            共 {scannedCount} 项，差异 {diffCount} 项。确认后将写入当日盘存结果。
          </div>
          <div className="radio-group mb">
            <label className={adjustStock ? 'checked' : ''}>
              <input type="radio" checked={adjustStock} onChange={() => setAdjustStock(true)} />
              <span>
                <b>记录并调整库存（推荐）</b>
                <div className="desc">写入实盘结果 + 为差异生成进出库流水 + 更新产品库存，保证可审计</div>
              </span>
            </label>
            <label className={!adjustStock ? 'checked' : ''}>
              <input type="radio" checked={!adjustStock} onChange={() => setAdjustStock(false)} />
              <span>
                <b>仅记录盘存结果</b>
                <div className="desc">只记录当日实盘数量，不改动库存与流水</div>
              </span>
            </label>
          </div>
          <div className="row">
            <button className="btn btn-primary btn-lg" disabled={confirming} onClick={() => void onConfirm()}>
              {confirming ? '确认中…' : '确认'}
            </button>
            <button className="btn" onClick={() => setShowConfirm(false)}>
              取消
            </button>
          </div>
        </Modal>
      )}

      {node}
    </>
  )
}
