import { useCallback, useEffect, useMemo, useState } from 'react'
import { listProducts, listSnapshots, listSnapshotsByDate } from '@/lib/localDb'
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

  const totalActual = snapshots?.reduce((a, s) => a + s.actual_qty, 0) ?? 0

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
        <section className="card">
          <div className="card-title">
            当日盘存结果 · {selected}
            <span className="muted" style={{ marginLeft: 8 }}>
              共 {snapshots?.length ?? 0} 项，合计 {totalActual}
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
                    <th className="t-num">实盘数量</th>
                    <th className="t-num">系统当前</th>
                    <th className="t-num">差异</th>
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
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {node}
    </>
  )
}
