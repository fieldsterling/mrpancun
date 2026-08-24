import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import { listProducts } from '@/lib/localDb'
import { buildProductIndex, buildSystemMap, reconcile, sumByCode, unitPrice } from '@/lib/reconcile'
import { confirmInventory } from '@/lib/confirm'
import { todayCN } from '@/lib/date'
import type { DiffRow, Product } from '@/lib/types'
import { Badge, Empty, Modal, Skeleton, useToast } from '@/components/ui'

interface Props {
  store: string
  onStoresChanged: () => void
}

/** 盘存导入的列名别名（与产品导入保持一致） */
const CODE_ALIAS = ['产品编号', '编号', 'code', '商品编号', 'productcode', '货号']
const QTY_ALIAS = ['数量', '库存', 'qty', 'quantity', '库存数量']
const STORE_ALIAS = ['店名', '门店', 'store']

type Flash = 'ok' | 'warn' | 'err' | null

/** 盘存草稿本地键：按 门店 + 业务日期 隔离，中断后可恢复 */
const draftKey = (store: string, date: string) => `scan_draft_${store}_${date}`

const fmtW = (n: number) => `${Math.round(n * 10) / 10} g`
const fmtA = (n: number) => `￥${Math.round(n * 100) / 100}`

export default function ScanPage({ store }: Props) {
  const { show, node } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null) // null = 加载中（骨架屏）
  const [actualMap, setActualMap] = useState<Map<string, number>>(new Map())
  const [query, setQuery] = useState('')
  const [flash, setFlash] = useState<Flash>(null)
  const [showConfirm, setShowConfirm] = useState(false)
  const [adjustStock, setAdjustStock] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [restored, setRestored] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const businessDate = todayCN()
  const draftKeyStr = draftKey(store, businessDate)

  const productIndex = useMemo(() => buildProductIndex(products ?? []), [products])
  // 条码 -> 产品编号 索引，扫码枪扫到条码也能匹配
  const barcodeIndex = useMemo(() => {
    const m = new Map<string, string>()
    for (const p of products ?? []) {
      const b = p.barcode?.trim()
      if (b) m.set(b, p.code)
    }
    return m
  }, [products])
  const systemMap = useMemo(() => buildSystemMap(products ?? []), [products])
  const diffRows = useMemo(
    () => reconcile({ systemMap, actualMap, productIndex }),
    [systemMap, actualMap, productIndex],
  )
  const sysSum = useMemo(() => sumByCode(systemMap, productIndex), [systemMap, productIndex])
  const actSum = useMemo(() => sumByCode(actualMap, productIndex), [actualMap, productIndex])

  const load = useCallback(async () => {
    setProducts(null)
    const list = await listProducts(store)
    setProducts(list)
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  // 挂载时恢复上次未完成的盘存草稿
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKeyStr)
      if (raw) {
        const arr = JSON.parse(raw) as [string, number][]
        if (Array.isArray(arr) && arr.length) {
          setActualMap(new Map(arr))
          setRestored(true)
        }
      }
    } catch {
      /* 草稿损坏则忽略 */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKeyStr])

  // 实盘数据实时写本地，中断（刷新/误关）后可恢复
  useEffect(() => {
    try {
      if (actualMap.size > 0) localStorage.setItem(draftKeyStr, JSON.stringify(Array.from(actualMap)))
      else localStorage.removeItem(draftKeyStr)
    } catch {
      /* 存储满时忽略 */
    }
  }, [actualMap, draftKeyStr])

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

  // 支持直接扫「产品编号」，也支持扫「条码」（自动映射回编号）
  const handleScan = () => {
    const raw = query.trim()
    setQuery('')
    if (!raw) return
    const code = productIndex.has(raw) ? raw : (barcodeIndex.get(raw) ?? raw)
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
    setRestored(false)
    show('已清空本次实盘数据', 'info')
  }

  // 盘存 TXT/CSV 解析：优先带表头（按列名识别 编号/数量，兼容产品信息表）；
  // 无表头则按「编号 [,数量]」两列，数量缺省为 1
  const importTxt = (text: string) => {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (lines.length === 0) return

    const sep = lines[0].includes('\t') ? '\t' : lines[0].includes(',') ? ',' : /\s+/
    const splitLine = (l: string) => l.split(sep).map((s) => s.trim().replace(/^"|"$/g, ''))
    const cells0 = splitLine(lines[0])
    const hit = (h: string, aliases: string[]) => aliases.some((a) => h.toLowerCase() === a.toLowerCase())
    const isHeader = cells0.some((h) => hit(h, CODE_ALIAS) || hit(h, QTY_ALIAS))

    const codeIdx = Math.max(0, cells0.findIndex((h) => hit(h, CODE_ALIAS)))
    const qtyIdx = cells0.findIndex((h) => hit(h, QTY_ALIAS))
    const storeIdx = cells0.findIndex((h) => hit(h, STORE_ALIAS))

    const next = new Map(actualMap)
    let count = 0
    for (const line of isHeader ? lines.slice(1) : lines) {
      const c = splitLine(line)
      if (c.length === 0) continue
      const code = (c[codeIdx] ?? '').trim()
      if (!code) continue
      // 表头含「店名」列时，跳过其他店的行，禁止混入其他门店的实盘数据
      if (storeIdx >= 0) {
        const s = (c[storeIdx] ?? '').trim()
        if (s && s !== store) continue
      }
      const raw = (qtyIdx >= 0 ? c[qtyIdx] : c.length > 1 ? c[1] : '') ?? ''
      const qty = Number(raw.replace(/,/g, ''))
      next.set(code, (next.get(code) ?? 0) + (Number.isFinite(qty) && qty >= 0 ? qty : 1))
      count++
    }
    setActualMap(next)
    show(`TXT 导入 ${count} 条`, 'ok')
  }

  // Excel 解析：按列名识别 产品编号/编号/code 与 数量/qty（兼容产品信息表）；无店名则默认当前门店
  const importExcel = async (file: File) => {
    const wb = XLSX.read(await file.arrayBuffer())
    const ws = wb.Sheets[wb.SheetNames[0]]
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws)
    const cell = (r: Record<string, unknown>, aliases: string[]) => {
      const k = Object.keys(r).find((key) => aliases.some((a) => key.trim().toLowerCase() === a.toLowerCase()))
      return k != null ? r[k] : undefined
    }
    const next = new Map(actualMap)
    let count = 0
    for (const r of rows) {
      const code = String(cell(r, CODE_ALIAS) ?? '').trim()
      if (!code) continue
      const storeName = String(cell(r, ['店名', '门店', 'store']) ?? '').trim()
      if (storeName && storeName !== store) continue // 仅统计当前门店
      const qty = Number(cell(r, QTY_ALIAS))
      next.set(code, (next.get(code) ?? 0) + (Number.isFinite(qty) && qty >= 0 ? qty : 1))
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
      const result = await confirmInventory({ store, businessDate, actualMap, adjustStock, reasons })
      setShowConfirm(false)
      setActualMap(new Map())
      setReasons({})
      setRestored(false)
      localStorage.removeItem(draftKeyStr)
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
  const scannedKnown = [...actualMap.keys()].filter((c) => productIndex.has(c)).length
  const scannedTotal = [...actualMap.values()].reduce((a, b) => a + b, 0)
  const unknownCount = scannedCount - scannedKnown
  const diffCount = diffRows.filter((d) => d.status !== 'MATCH').length
  const completion = systemMap.size > 0 ? Math.round((scannedKnown / systemMap.size) * 100) : 0
  const diffDetails = diffRows.filter((d) => d.status !== 'MATCH')

  // 未盘清单：系统在册且数量>0 但尚未扫到的商品
  const unScanned = useMemo(() => {
    if (!products) return []
    return products
      .filter((p) => p.qty > 0 && !actualMap.has(p.code))
      .sort((a, b) => a.code.localeCompare(b.code, 'zh-CN'))
  }, [products, actualMap])

  const diffColor = (n: number) =>
    n === 0 ? 'var(--text-muted)' : n > 0 ? 'var(--warn)' : 'var(--danger)'

  const statusBadge = (d: DiffRow) => {
    if (d.status === 'MATCH') return <Badge kind="ok">一致</Badge>
    if (d.status === 'SYSTEM_MISSING') return <Badge kind="danger">盘亏</Badge>
    return <Badge kind="warn">盘盈</Badge>
  }

  return (
    <>
      <section className="card">
        <div className="card-title">
          扫码盘存 · {businessDate}
          {restored && actualMap.size > 0 && <Badge kind="gold">已恢复上次草稿</Badge>}
        </div>
        <input
          ref={inputRef}
          className={`scan-input ${flash ? `flash-${flash}` : ''}`}
          placeholder="扫描或输入产品编号 / 条码，回车即计数（可连接扫码枪）"
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
            <div className="num" style={{ color: completion === 100 ? 'var(--ok)' : 'var(--gold-deep)' }}>
              {completion}%
            </div>
            <div className="lbl">完成率</div>
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
        <div className="card-title">件数 · 克重 · 金额对账</div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>维度</th>
                <th className="t-num">系统</th>
                <th className="t-num">实盘</th>
                <th className="t-num">差异</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>件数</td>
                <td className="t-num">{sysSum.qty}</td>
                <td className="t-num">{actSum.qty}</td>
                <td className="t-num" style={{ color: diffColor(actSum.qty - sysSum.qty), fontWeight: 700 }}>
                  {actSum.qty - sysSum.qty > 0 ? `+${actSum.qty - sysSum.qty}` : actSum.qty - sysSum.qty}
                </td>
              </tr>
              <tr>
                <td>克重</td>
                <td className="t-num">{fmtW(sysSum.weight)}</td>
                <td className="t-num">{fmtW(actSum.weight)}</td>
                <td className="t-num" style={{ color: diffColor(actSum.weight - sysSum.weight), fontWeight: 700 }}>
                  {actSum.weight - sysSum.weight > 0
                    ? `+${fmtW(actSum.weight - sysSum.weight)}`
                    : fmtW(actSum.weight - sysSum.weight)}
                </td>
              </tr>
              <tr>
                <td>金额</td>
                <td className="t-num">{fmtA(sysSum.amount)}</td>
                <td className="t-num">{fmtA(actSum.amount)}</td>
                <td className="t-num" style={{ color: diffColor(actSum.amount - sysSum.amount), fontWeight: 700 }}>
                  {actSum.amount - sysSum.amount > 0
                    ? `+${fmtA(actSum.amount - sysSum.amount)}`
                    : fmtA(actSum.amount - sysSum.amount)}
                </td>
              </tr>
            </tbody>
          </table>
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
                  <th className="t-num">单件克重</th>
                  <th className="t-num">系统数量</th>
                  <th>实盘数量</th>
                  <th className="t-num">差异</th>
                  <th className="t-num">金额差异</th>
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
                    <td className="t-num">{d.gramWeight > 0 ? fmtW(d.gramWeight) : <span className="muted">—</span>}</td>
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
                    <td className="t-num" style={{ color: diffColor(d.diff), fontWeight: 700 }}>
                      {d.diff > 0 ? `+${d.diff}` : d.diff}
                    </td>
                    <td className="t-num" style={{ color: diffColor(unitPrice(productIndex.get(d.code)) * d.diff), fontWeight: 700 }}>
                      {(() => {
                        const amt = unitPrice(productIndex.get(d.code)) * d.diff
                        if (amt === 0) return 0
                        return amt > 0 ? `+${fmtA(amt)}` : fmtA(amt)
                      })()}
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
            onClick={() => {
              setReasons({})
              setShowConfirm(true)
            }}
          >
            确认盘存
          </button>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          未盘清单 · 完成率 {completion}%
          <span className="muted" style={{ marginLeft: 8 }}>
            {unScanned.length} 项待盘
          </span>
        </div>
        <div className="progress">
          <div className="progress-fill" style={{ width: `${completion}%` }} />
        </div>
        {unScanned.length === 0 ? (
          <Empty text="全部在册商品均已盘到" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>类别</th>
                  <th className="t-num">系统数量</th>
                </tr>
              </thead>
              <tbody>
                {unScanned.map((p) => (
                  <tr key={p.code}>
                    <td>{p.code}</td>
                    <td>{p.name}</td>
                    <td>{p.category || <span className="muted">—</span>}</td>
                    <td className="t-num">{p.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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

          {diffDetails.length > 0 && (
            <div className="mb">
              <div className="muted mb">为差异项填写原因（可选，将写入流水备注）：</div>
              <div className="reason-list">
                {diffDetails.map((d) => (
                  <div key={d.code} className="reason-row">
                    <span className="reason-label">
                      {d.code} · {d.name || '库外'}
                      <Badge kind={d.status === 'SYSTEM_MISSING' ? 'danger' : 'warn'}>
                        {d.diff > 0 ? `+${d.diff}` : d.diff}
                      </Badge>
                    </span>
                    <input
                      className="input"
                      placeholder="原因（如：破损、赠品、录入错误…）"
                      value={reasons[d.code] ?? ''}
                      onChange={(e) => setReasons((prev) => ({ ...prev, [d.code]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

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
