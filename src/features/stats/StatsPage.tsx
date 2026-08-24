import { useCallback, useEffect, useMemo, useState } from 'react'
import { listProducts } from '@/lib/localDb'
import type { Product } from '@/lib/types'
import { unitPrice } from '@/lib/reconcile'
import { Badge, Empty, Skeleton, useToast } from '@/components/ui'
import { METALS, loadMetalPrices, realUnitPrice, saveMetalPrices, type MetalPrices } from '@/lib/metal'
import { todayCN } from '@/lib/date'

interface Props {
  store: string
}

type GroupKey = 'material' | 'name'

// 库存龄分组：半年以上未售 / 3-6 月未售 / 3 个月内新品
type AgeKey = 'old' | 'mid' | 'new'

const AGE_SEGS: Array<{ key: AgeKey; label: string; hint: string }> = [
  { key: 'old', label: '半年以上未售', hint: '入库超过 180 天' },
  { key: 'mid', label: '3-6 月未售', hint: '入库 90-180 天' },
  { key: 'new', label: '3 个月内新品', hint: '入库不超过 90 天' },
]

/** 判断产品所属库存龄分组（按首次入库时间，缺省回退到最后编辑时间） */
function ageKeyOf(p: Product, now: number): AgeKey {
  const t = new Date(p.created_at || p.updated_at).getTime()
  const days = Number.isFinite(t) ? Math.max(0, (now - t) / 86400000) : 0
  if (days > 180) return 'old'
  if (days > 90) return 'mid'
  return 'new'
}

interface AgeSummary {
  qty: number
  weight: number
  amount: number
}

/** 一组产品的 数量/克重/金额 汇总 */
function summarize(list: Product[]): AgeSummary {
  return list.reduce(
    (a, p) => {
      a.qty += p.qty
      a.weight += (p.gram_weight || 0) * p.qty
      a.amount += unitPrice(p) * p.qty
      return a
    },
    { qty: 0, weight: 0, amount: 0 },
  )
}

interface GroupRow {
  key: string
  kinds: number // 种类数
  qty: number // 数量
  weight: number // 总克重
  amount: number // 账面总价格
  realAmount: number // 今日真实总价
}

const fmtW = (n: number) => `${Math.round(n * 10) / 10} g`
const fmtA = (n: number) => `￥${Math.round(n * 100) / 100}`

export default function StatsPage({ store }: Props) {
  const { show, node } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [group, setGroup] = useState<GroupKey>('material')
  const [age, setAge] = useState<AgeKey>('old')
  // 今日金银价格（本地存储，按门店隔离）
  const [prices, setPrices] = useState<MetalPrices>(() => loadMetalPrices(store))
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setProducts(null)
    setProducts(await listProducts(store))
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  const setPrice = (key: keyof MetalPrices, value: string) => {
    const v = value.trim() === '' ? undefined : Number(value)
    setPrices((prev) => ({ ...prev, [key]: v }))
  }

  const savePrices = async () => {
    setSaving(true)
    try {
      saveMetalPrices(store, prices)
      show('今日金银价格已保存', 'ok')
    } finally {
      setSaving(false)
    }
  }

  const hasToday = METALS.some(({ key }) => (prices[key] ?? 0) > 0)

  // 全店总览
  const totals = useMemo(() => {
    const list = products ?? []
    return list.reduce(
      (a, p) => {
        a.kinds += 1
        a.qty += p.qty
        a.weight += (p.gram_weight || 0) * p.qty
        a.amount += p.total_price || 0
        a.realAmount += realUnitPrice(p, prices) * p.qty
        return a
      },
      { kinds: 0, qty: 0, weight: 0, amount: 0, realAmount: 0 },
    )
  }, [products, prices])

  // 按 材质 / 名称 分组统计
  const rows = useMemo<GroupRow[]>(() => {
    if (!products) return []
    const map = new Map<string, GroupRow>()
    for (const p of products) {
      const key = (group === 'material' ? p.material : p.name).trim() || '未分类'
      let r = map.get(key)
      if (!r) {
        r = { key, kinds: 0, qty: 0, weight: 0, amount: 0, realAmount: 0 }
        map.set(key, r)
      }
      r.kinds += 1
      r.qty += p.qty
      r.weight += (p.gram_weight || 0) * p.qty
      r.amount += p.total_price || 0
      r.realAmount += realUnitPrice(p, prices) * p.qty
    }
    return Array.from(map.values()).sort((a, b) => b.realAmount - a.realAmount)
  }, [products, group, prices])

  // 库存龄分组（只统计当前在库产品）
  const ageGroups = useMemo(() => {
    const map: Record<AgeKey, Product[]> = { old: [], mid: [], new: [] }
    const now = Date.now()
    for (const p of products ?? []) {
      if (p.qty <= 0) continue
      map[ageKeyOf(p, now)].push(p)
    }
    // 每组按数量降序，同数量按名称排序
    for (const k of Object.keys(map) as AgeKey[]) {
      map[k].sort(
        (a, b) =>
          b.qty - a.qty ||
          (a.name || '').localeCompare(b.name || '', 'zh-CN') ||
          a.code.localeCompare(b.code, 'zh-CN'),
      )
    }
    return map
  }, [products])

  const ageSum = useMemo(() => summarize(ageGroups[age]), [ageGroups, age])

  // 中国时区日期（YYYY-MM-DD）
  const fmtD = (iso: string) => {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '—'
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d)
  }

  return (
    <>
      <section className="card">
        <div className="card-title">
          今日金银价格设置
          <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
            {todayCN()}
          </span>
          {hasToday && <Badge kind="ok">已设置</Badge>}
        </div>
        <div className="row" style={{ flexWrap: 'wrap', gap: 10 }}>
          {METALS.map(({ key, label }) => (
            <div className="field" key={key} style={{ flex: '1 1 140px', minWidth: 120, marginBottom: 0 }}>
              <label>{label}（元/克）</label>
              <input
                className="input"
                type="number"
                min={0}
                step={0.1}
                placeholder="未设置"
                value={prices[key] ?? ''}
                onChange={(e) => setPrice(key, e.target.value)}
              />
            </div>
          ))}
        </div>
        <div className="row mt" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" disabled={saving} onClick={() => void savePrices()}>
            {saving ? '保存中…' : '保存今日价格'}
          </button>
          <span className="muted" style={{ fontSize: 12 }}>
            真实总价按「克重 × (今日价 + 克工费) + 件工费」自动结算；未设置的金属回退到产品自身克单价
          </span>
        </div>
      </section>

      <section className="card">
        <div className="card-title">库存统计 · {store}</div>
        {products === null ? (
          <Skeleton lines={2} />
        ) : (
          <div className="stats">
            <div className="stat">
              <div className="num">{totals.kinds}</div>
              <div className="lbl">产品种类</div>
            </div>
            <div className="stat">
              <div className="num">{totals.qty}</div>
              <div className="lbl">总数量</div>
            </div>
            <div className="stat">
              <div className="num">{fmtW(totals.weight)}</div>
              <div className="lbl">总克重</div>
            </div>
            <div className="stat">
              <div className="num">{fmtA(totals.amount)}</div>
              <div className="lbl">账面总价格</div>
            </div>
            <div className="stat">
              <div className="num" style={{ color: 'var(--gold)' }}>
                {fmtA(totals.realAmount)}
              </div>
              <div className="lbl">今日真实总价</div>
            </div>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          分组统计
          <span className="row" style={{ marginLeft: 'auto', gap: 6 }}>
            <button
              className={`nav-btn ${group === 'material' ? 'active' : ''}`}
              onClick={() => setGroup('material')}
            >
              按材质
            </button>
            <button
              className={`nav-btn ${group === 'name' ? 'active' : ''}`}
              onClick={() => setGroup('name')}
            >
              按名称
            </button>
          </span>
        </div>
        {products === null ? (
          <Skeleton lines={6} />
        ) : rows.length === 0 ? (
          <Empty text="暂无产品数据，先导入或新增产品后再查看统计" />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{group === 'material' ? '材质' : '名称'}</th>
                  <th className="t-num">种类数</th>
                  <th className="t-num">数量</th>
                  <th className="t-num">总克重</th>
                  <th className="t-num">账面总价格</th>
                  <th className="t-num">今日真实总价</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.key}</td>
                    <td className="t-num">{r.kinds}</td>
                    <td className="t-num">{r.qty}</td>
                    <td className="t-num">{fmtW(r.weight)}</td>
                    <td className="t-num">{fmtA(r.amount)}</td>
                    <td className="t-num" style={{ fontWeight: 700 }}>
                      {fmtA(r.realAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">
          库存龄分析
          <span className="muted" style={{ fontSize: 12, fontWeight: 400 }}>
            按首次入库时间
          </span>
          <span className="row" style={{ marginLeft: 'auto', gap: 6, flexWrap: 'wrap' }}>
            {AGE_SEGS.map(({ key, label }) => (
              <button
                key={key}
                className={`nav-btn ${age === key ? 'active' : ''}`}
                onClick={() => setAge(key)}
              >
                {label}（{ageGroups[key].length}）
              </button>
            ))}
          </span>
        </div>
        {products === null ? (
          <Skeleton lines={6} />
        ) : ageGroups[age].length === 0 ? (
          <Empty
            text={`${AGE_SEGS.find((s) => s.key === age)?.hint}，当前没有在库产品`}
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>材质</th>
                  <th className="t-num">入库日期</th>
                  <th className="t-num">数量</th>
                  <th className="t-num">克重</th>
                  <th className="t-num">金额</th>
                </tr>
              </thead>
              <tbody>
                {ageGroups[age].map((p) => (
                  <tr key={p.code}>
                    <td>{p.code}</td>
                    <td>{p.name || <span className="muted">—</span>}</td>
                    <td>{p.material || <span className="muted">—</span>}</td>
                    <td className="t-num">{fmtD(p.created_at || p.updated_at)}</td>
                    <td className="t-num">{p.qty}</td>
                    <td className="t-num">{fmtW((p.gram_weight || 0) * p.qty)}</td>
                    <td className="t-num">{fmtA(unitPrice(p) * p.qty)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4} style={{ fontWeight: 700, textAlign: 'right' }}>
                    合计
                  </td>
                  <td className="t-num" style={{ fontWeight: 700 }}>
                    {ageSum.qty}
                  </td>
                  <td className="t-num" style={{ fontWeight: 700 }}>
                    {fmtW(ageSum.weight)}
                  </td>
                  <td className="t-num" style={{ fontWeight: 700 }}>
                    {fmtA(ageSum.amount)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      {node}
    </>
  )
}
