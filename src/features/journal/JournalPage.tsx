import { useCallback, useEffect, useMemo, useState } from 'react'
import { listJournal, listProducts } from '@/lib/localDb'
import { unitPrice } from '@/lib/reconcile'
import { addDaysCN, cnDateOf, formatCN, todayCN } from '@/lib/date'
import type { JournalEntry, Product } from '@/lib/types'
import { Badge, DateRange, Empty, Skeleton } from '@/components/ui'

interface Props {
  store: string
}

type Dir = 'ALL' | 'IN' | 'OUT'

export default function JournalPage({ store }: Props) {
  const [journal, setJournal] = useState<JournalEntry[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [dir, setDir] = useState<Dir>('ALL')
  const [query, setQuery] = useState('')
  // 出入库记录时间区间（默认近3天）
  const [range, setRange] = useState<[string, string]>(() => [
    addDaysCN(todayCN(), -2),
    todayCN(),
  ])

  const load = useCallback(async () => {
    setJournal(null)
    const [j, p] = await Promise.all([listJournal(store), listProducts(store)])
    setJournal(j)
    setProducts(p)
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  const productIndex = useMemo(
    () => new Map(products.map((p) => [p.code, p])),
    [products],
  )

  const filtered = useMemo(() => {
    if (!journal) return []
    const q = query.trim().toLowerCase()
    const s = range[0] || '1970-01-01'
    const en = range[1] || '2099-12-31'
    const list = journal.filter((e) => {
      if (dir !== 'ALL' && e.direction !== dir) return false
      // 时间区间（按中国时区日期）
      const d = cnDateOf(e.ts)
      if (d < s || d > en) return false
      if (q) {
        const p = productIndex.get(e.product_code)
        const hay = `${e.product_code} ${p?.name ?? ''} ${e.note}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    // 时间倒序（最新在前），同时刻按 source_id 稳定排序
    return list.sort((a, b) => (a.ts === b.ts ? a.source_id.localeCompare(b.source_id) : a.ts < b.ts ? 1 : -1))
  }, [journal, dir, query, range, productIndex])

  const inTotal = journal?.filter((e) => e.direction === 'IN').reduce((a, e) => a + e.qty, 0) ?? 0
  const outTotal = journal?.filter((e) => e.direction === 'OUT').reduce((a, e) => a + e.qty, 0) ?? 0

  return (
    <>
      <section className="card">
        <div className="card-title">流水明细 · {store}</div>
        <div className="stats">
          <div className="stat">
            <div className="num">{journal?.length ?? '-'}</div>
            <div className="lbl">流水总数</div>
          </div>
          <div className="stat">
            <div className="num" style={{ color: 'var(--ok)' }}>
              +{inTotal}
            </div>
            <div className="lbl">累计入库</div>
          </div>
          <div className="stat">
            <div className="num" style={{ color: 'var(--danger)' }}>
              −{outTotal}
            </div>
            <div className="lbl">累计出库</div>
          </div>
        </div>
        <div className="row mt">
          <input
            className="input"
            placeholder="搜索编号 / 名称 / 备注"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 320 }}
          />
          {(['ALL', 'IN', 'OUT'] as const).map((d) => (
            <button
              key={d}
              className={`nav-btn ${dir === d ? 'active' : ''}`}
              onClick={() => setDir(d)}
            >
              {d === 'ALL' ? '全部' : d === 'IN' ? '入库' : '出库'}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          出入库记录
          <DateRange
            start={range[0]}
            end={range[1]}
            onChange={(s, e) => setRange([s, e])}
          />
        </div>
        {journal === null ? (
          <Skeleton lines={6} />
        ) : filtered.length === 0 ? (
          <Empty text="暂无流水记录，确认盘存后系统会自动生成差异流水" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>编号</th>
                  <th>名称</th>
                  <th>方向</th>
                  <th className="t-num">数量</th>
                  <th className="t-num">克单价</th>
                  <th className="t-num">金额</th>
                  <th>备注</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((e) => {
                  const p = productIndex.get(e.product_code)
                  const perUnit = unitPrice(p)
                  // 优先展示交易时克单价，无记录时回退到产品当前克单价
                  const unitPriceAt = e.unit_price ?? p?.gram_price ?? 0
                  return (
                    <tr key={e.source_id}>
                      <td>{formatCN(e.ts)}</td>
                      <td>{e.product_code}</td>
                      <td>{p?.name || <span className="muted">—</span>}</td>
                      <td>
                        {e.direction === 'IN' ? <Badge kind="ok">入</Badge> : <Badge kind="danger">出</Badge>}
                      </td>
                      <td className="t-num" style={{ fontWeight: 700 }}>
                        {e.direction === 'IN' ? `+${e.qty}` : `−${e.qty}`}
                      </td>
                      <td className="t-num">
                        {unitPriceAt > 0 ? unitPriceAt : <span className="muted">—</span>}
                      </td>
                      <td className="t-num">
                        {e.direction === 'OUT' && e.settle_price
                          ? `￥${Math.round(e.settle_price * 100) / 100}`
                          : perUnit > 0
                            ? `￥${Math.round(perUnit * e.qty * 100) / 100}`
                            : <span className="muted">—</span>}
                      </td>
                      <td>{e.note || <span className="muted">—</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}
