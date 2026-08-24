import { useCallback, useEffect, useMemo, useState } from 'react'
import { listJournal, listProducts } from '@/lib/localDb'
import { addDaysCN, addMonthsCN, cnDateOf, formatCN, monthOf, todayCN } from '@/lib/date'
import type { JournalEntry, Product } from '@/lib/types'
import { DateRange, Empty, Skeleton } from '@/components/ui'

interface Props {
  store: string
}

interface DayStat {
  day: string
  count: number
  qty: number
  amount: number
}

interface MonthStat {
  month: string
  count: number
  qty: number
  amount: number
}

const fmtA = (n: number) => `￥${Math.round(n * 100) / 100}`

/** 判断记录是否落在 YYYY-MM-DD 区间内（空值视为不限） */
function inDayRange(e: JournalEntry, r: [string, string]): boolean {
  const d = cnDateOf(e.ts)
  const s = r[0] || '1970-01-01'
  const en = r[1] || '2099-12-31'
  return d >= s && d <= en
}

/** 判断记录是否落在 YYYY-MM 月份区间内（空值视为不限） */
function inMonthRange(e: JournalEntry, r: [string, string]): boolean {
  const m = cnDateOf(e.ts).slice(0, 7)
  const s = r[0] || '1970-01'
  const en = r[1] || '2099-12'
  return m >= s && m <= en
}

/** 按天分组（入参保持倒序，同日保持时间倒序） */
function groupByDay(list: JournalEntry[]) {
  const groups = new Map<string, JournalEntry[]>()
  for (const e of list) {
    const d = cnDateOf(e.ts)
    const arr = groups.get(d)
    if (arr) arr.push(e)
    else groups.set(d, [e])
  }
  return Array.from(groups.entries()).map(([day, rows]) => ({
    day,
    rows,
    qty: rows.reduce((a, x) => a + x.qty, 0),
    amount: rows.reduce((a, x) => a + (x.settle_price ?? 0), 0),
  }))
}

/**
 * 出库结算：统计手动出库（带结算价 settle_price）的记录。
 * 盘存调整产生的 OUT 流水不含结算价，不计入结算。
 */
export default function SettlementPage({ store }: Props) {
  const [journal, setJournal] = useState<JournalEntry[] | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  // 各分区时间区间（默认：明细近3天 / 每天统计近7天 / 每月统计近12个月）
  const [detailRange, setDetailRange] = useState<[string, string]>(() => [
    addDaysCN(todayCN(), -2),
    todayCN(),
  ])
  const [dailyRange, setDailyRange] = useState<[string, string]>(() => [
    addDaysCN(todayCN(), -6),
    todayCN(),
  ])
  const [monthlyRange, setMonthlyRange] = useState<[string, string]>(() => [
    monthOf(addMonthsCN(todayCN(), -11)),
    monthOf(todayCN()),
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

  const productIndex = useMemo(() => new Map(products.map((p) => [p.code, p])), [products])

  // listJournal 已按时间倒序，这里保持倒序做分组
  const entries = useMemo(
    () => (journal ?? []).filter((e) => e.direction === 'OUT' && (e.settle_price ?? 0) > 0),
    [journal],
  )

  // 每天结算明细（按明细区间过滤）
  const detailGroups = useMemo(
    () => groupByDay(entries.filter((e) => inDayRange(e, detailRange))),
    [entries, detailRange],
  )

  // 每天统计表（按每天统计区间过滤）
  const dailyRows: DayStat[] = useMemo(
    () =>
      groupByDay(entries.filter((e) => inDayRange(e, dailyRange))).map((g) => ({
        day: g.day,
        count: g.rows.length,
        qty: g.qty,
        amount: g.amount,
      })),
    [entries, dailyRange],
  )

  // 每月统计表（按月区间过滤后聚合，保持倒序）
  const monthlyRows: MonthStat[] = useMemo(() => {
    const map = new Map<string, MonthStat>()
    for (const g of groupByDay(entries.filter((e) => inMonthRange(e, monthlyRange)))) {
      const month = g.day.slice(0, 7)
      const cur = map.get(month)
      if (cur) {
        cur.count += g.rows.length
        cur.qty += g.qty
        cur.amount += g.amount
      } else {
        map.set(month, { month, count: g.rows.length, qty: g.qty, amount: g.amount })
      }
    }
    return Array.from(map.values())
  }, [entries, monthlyRange])

  // 每天统计表合计
  const dailyTotal = useMemo(
    () =>
      dailyRows.reduce(
        (a, r) => ({ count: a.count + r.count, qty: a.qty + r.qty, amount: a.amount + r.amount }),
        { count: 0, qty: 0, amount: 0 },
      ),
    [dailyRows],
  )
  // 每月统计表合计
  const monthlyTotal = useMemo(
    () =>
      monthlyRows.reduce(
        (a, r) => ({ count: a.count + r.count, qty: a.qty + r.qty, amount: a.amount + r.amount }),
        { count: 0, qty: 0, amount: 0 },
      ),
    [monthlyRows],
  )

  // 概览卡（全部时间，不做区间过滤）
  const totalQty = useMemo(() => entries.reduce((a, e) => a + e.qty, 0), [entries])
  const totalAmount = useMemo(() => entries.reduce((a, e) => a + (e.settle_price ?? 0), 0), [entries])

  return (
    <>
      <section className="card">
        <div className="card-title">出库结算 · {store}</div>
        <div className="stats">
          <div className="stat">
            <div className="num">{entries.length}</div>
            <div className="lbl">结算笔数</div>
          </div>
          <div className="stat">
            <div className="num">{totalQty}</div>
            <div className="lbl">出库件数</div>
          </div>
          <div className="stat">
            <div className="num">{fmtA(totalAmount)}</div>
            <div className="lbl">累计结算金额</div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-title">
          每天结算明细（时间倒序）
          <DateRange
            start={detailRange[0]}
            end={detailRange[1]}
            onChange={(s, e) => setDetailRange([s, e])}
          />
        </div>
        {journal === null ? (
          <Skeleton lines={6} />
        ) : detailGroups.length === 0 ? (
          <Empty text="当前时间区间内暂无出库结算记录" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>编号</th>
                  <th>名称</th>
                  <th className="t-num">数量</th>
                  <th className="t-num">克单价</th>
                  <th className="t-num">结算金额</th>
                  <th>原因</th>
                  <th>客户</th>
                </tr>
              </thead>
              <tbody>
                {detailGroups.map((g) => (
                  <DayGroup
                    key={g.day}
                    day={g.day}
                    count={g.rows.length}
                    qty={g.qty}
                    amount={g.amount}
                    rows={g.rows}
                    productIndex={productIndex}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          每天统计表（时间倒序）
          <DateRange
            start={dailyRange[0]}
            end={dailyRange[1]}
            onChange={(s, e) => setDailyRange([s, e])}
          />
        </div>
        {dailyRows.length === 0 ? (
          <Empty text="当前时间区间内暂无数据" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th className="t-num">笔数</th>
                  <th className="t-num">出库件数</th>
                  <th className="t-num">结算金额</th>
                </tr>
              </thead>
              <tbody>
                {dailyRows.map((r) => (
                  <tr key={r.day}>
                    <td>{r.day}</td>
                    <td className="t-num">{r.count}</td>
                    <td className="t-num">{r.qty}</td>
                    <td className="t-num">{fmtA(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>合计</td>
                  <td className="t-num">{dailyTotal.count}</td>
                  <td className="t-num">{dailyTotal.qty}</td>
                  <td className="t-num">{fmtA(dailyTotal.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          每月统计表（时间倒序）
          <DateRange
            mode="month"
            start={monthlyRange[0]}
            end={monthlyRange[1]}
            onChange={(s, e) => setMonthlyRange([s, e])}
          />
        </div>
        {monthlyRows.length === 0 ? (
          <Empty text="当前时间区间内暂无数据" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>月份</th>
                  <th className="t-num">笔数</th>
                  <th className="t-num">出库件数</th>
                  <th className="t-num">结算金额</th>
                </tr>
              </thead>
              <tbody>
                {monthlyRows.map((r) => (
                  <tr key={r.month}>
                    <td>{r.month}</td>
                    <td className="t-num">{r.count}</td>
                    <td className="t-num">{r.qty}</td>
                    <td className="t-num">{fmtA(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>合计</td>
                  <td className="t-num">{monthlyTotal.count}</td>
                  <td className="t-num">{monthlyTotal.qty}</td>
                  <td className="t-num">{fmtA(monthlyTotal.amount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

/** 某一天的结算明细分组（表头行 + 明细行） */
function DayGroup({
  day,
  count,
  qty,
  amount,
  rows,
  productIndex,
}: {
  day: string
  count: number
  qty: number
  amount: number
  rows: JournalEntry[]
  productIndex: Map<string, Product>
}) {
  return (
    <>
      <tr className="day-row">
        <td colSpan={8}>
          {day}（{count} 笔 · {qty} 件 · {fmtA(amount)}）
        </td>
      </tr>
      {rows.map((e) => {
        const p = productIndex.get(e.product_code)
        return (
          <tr key={e.source_id}>
            <td>{formatCN(e.ts)}</td>
            <td>{e.product_code}</td>
            <td>{p?.name || <span className="muted">—</span>}</td>
            <td className="t-num" style={{ fontWeight: 700, color: 'var(--danger)' }}>
              −{e.qty}
            </td>
            <td className="t-num">
              {e.unit_price ? e.unit_price : <span className="muted">—</span>}
            </td>
            <td className="t-num">{fmtA(e.settle_price ?? 0)}</td>
            <td>{e.note || <span className="muted">—</span>}</td>
            <td>{e.customer || <span className="muted">—</span>}</td>
          </tr>
        )
      })}
    </>
  )
}
