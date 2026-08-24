import { useCallback, useEffect, useMemo, useState } from 'react'
import * as XLSX from 'xlsx'
import { listProducts, listSnapshots, listSnapshotsByDate } from '@/lib/localDb'
import { unitPrice } from '@/lib/reconcile'
import { todayCN } from '@/lib/date'
import type { DailySnapshot, Product } from '@/lib/types'
import { Empty, Skeleton, useToast } from '@/components/ui'

interface Props {
  store: string
}

export default function HistoryPage({ store }: Props) {
  const { node } = useToast()
  const [dates, setDates] = useState<string[]>([])
  const [selected, setSelected] = useState<string>(todayCN())
  const [snapshots, setSnapshots] = useState<DailySnapshot[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])

  const loadMeta = useCallback(async () => {
    const all = await listSnapshots(store)
    const ds = Array.from(new Set(all.map((s) => s.business_date)))
      .sort()
      .reverse()
    setDates(ds)
    setSelected((prev) => (ds.includes(prev) ? prev : (ds[0] ?? todayCN())))
    setProducts(await listProducts(store))
  }, [store])

  useEffect(() => {
    void loadMeta()
  }, [loadMeta])

  useEffect(() => {
    if (!selected) return
    setSnapshots(null)
    void listSnapshotsByDate(selected, store).then((rows) => setSnapshots(rows))
  }, [selected, store])

  const productIndex = useMemo(
    () => new Map(products.map((p) => [p.code, p])),
    [products],
  )

  // 汇总：件数 / 克重 / 金额
  const totalQty = snapshots?.reduce((a, s) => a + s.actual_qty, 0) ?? 0
  const totalWeight =
    snapshots?.reduce((a, s) => {
      const p = productIndex.get(s.product_code)
      return a + (p?.gram_weight ?? 0) * s.actual_qty
    }, 0) ?? 0
  const totalAmount =
    snapshots?.reduce((a, s) => {
      const p = productIndex.get(s.product_code)
      return a + (p ? unitPrice(p) * s.actual_qty : 0)
    }, 0) ?? 0

  const exportExcel = () => {
    if (!snapshots || snapshots.length === 0) return
    const rows = snapshots.map((s) => {
      const p = productIndex.get(s.product_code)
      const current = p?.qty ?? 0
      const diff = s.actual_qty - current
      return {
        编号: s.product_code,
        名称: p?.name ?? '',
        类别: p?.category ?? '',
        单件克重: p?.gram_weight ?? 0,
        实盘数量: s.actual_qty,
        系统当前: current,
        数量差异: diff,
        金额差异: Math.round(unitPrice(p) * diff * 100) / 100,
      }
    })
    const sum = rows.reduce(
      (acc, r) => {
        acc.qty += r.实盘数量
        acc.weight += r.单件克重 * r.实盘数量
        acc.amount += Math.round(unitPrice(productIndex.get(r.编号)) * r.实盘数量 * 100) / 100
        return acc
      },
      { qty: 0, weight: 0, amount: 0 },
    )
    rows.push({
      编号: '合计',
      名称: '',
      类别: '',
      单件克重: 0,
      实盘数量: sum.qty,
      系统当前: 0,
      数量差异: 0,
      金额差异: Math.round(sum.amount * 100) / 100,
    })
    const ws = XLSX.utils.json_to_sheet(rows)
    ws['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 12 }]
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, '盘存')
    XLSX.writeFile(wb, `盘存报告_${store}_${selected}.xlsx`)
  }

  return (
    <>
      <section className="card">
        <div className="card-title">盘存历史 · {store}</div>
        {dates.length === 0 ? (
          <Empty text="暂无盘存记录，去「扫码盘存」完成一次确认后即可查看" />
        ) : (
          <div className="row">
            {dates.map((d) => (
              <button
                key={d}
                className={`nav-btn ${d === selected ? 'active' : ''}`}
                onClick={() => setSelected(d)}
              >
                {d}
              </button>
            ))}
          </div>
        )}
      </section>

      {selected && dates.length > 0 && (
        <>
          <section className="card">
            <div className="card-title">
              当日盘存汇总 · {selected}
              <button
                className="btn btn-sm"
                style={{ marginLeft: 'auto' }}
                onClick={exportExcel}
                disabled={!snapshots || snapshots.length === 0}
              >
                导出 Excel
              </button>
            </div>
            {snapshots === null ? (
              <Skeleton lines={3} />
            ) : (
              <div className="stats">
                <div className="stat">
                  <div className="num">{snapshots.length}</div>
                  <div className="lbl">盘点种类</div>
                </div>
                <div className="stat">
                  <div className="num">{totalQty}</div>
                  <div className="lbl">实盘件数</div>
                </div>
                <div className="stat">
                  <div className="num">{Math.round(totalWeight * 10) / 10} g</div>
                  <div className="lbl">实盘克重</div>
                </div>
                <div className="stat">
                  <div className="num">￥{Math.round(totalAmount * 100) / 100}</div>
                  <div className="lbl">实盘金额</div>
                </div>
              </div>
            )}
          </section>

          <section className="card">
            <div className="card-title">
              当日盘存结果 · {selected}
              <span className="muted" style={{ marginLeft: 8 }}>
                共 {snapshots?.length ?? 0} 项
              </span>
            </div>
            {snapshots === null ? (
              <Skeleton lines={5} />
            ) : snapshots.length === 0 ? (
              <Empty text="该日无盘存数据" />
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>编号</th>
                      <th>名称</th>
                      <th>类别</th>
                      <th className="t-num">单件克重</th>
                      <th className="t-num">实盘数量</th>
                      <th className="t-num">系统当前</th>
                      <th className="t-num">差异</th>
                      <th className="t-num">金额差异</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshots.map((s) => {
                      const p = productIndex.get(s.product_code)
                      const current = p?.qty ?? 0
                      const diff = s.actual_qty - current
                      return (
                        <tr key={s.product_code}>
                          <td>{s.product_code}</td>
                          <td>{p?.name || <span className="muted">—</span>}</td>
                          <td>{p?.category || <span className="muted">—</span>}</td>
                          <td className="t-num">
                            {p?.gram_weight ? Math.round(p.gram_weight * 10) / 10 : <span className="muted">—</span>}
                          </td>
                          <td className="t-num">{s.actual_qty}</td>
                          <td className="t-num">{current}</td>
                          <td
                            className="t-num"
                            style={{
                              color: diff === 0 ? 'var(--text-muted)' : diff > 0 ? 'var(--warn)' : 'var(--danger)',
                              fontWeight: 700,
                            }}
                          >
                            {diff === 0 ? 0 : diff > 0 ? `+${diff}` : diff}
                          </td>
                          <td className="t-num">
                            {(() => {
                              const amt = Math.round(unitPrice(p) * diff * 100) / 100
                              if (amt === 0) return 0
                              return amt > 0 ? `+￥${amt}` : `￥${amt}`
                            })()}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}

      {node}
    </>
  )
}
