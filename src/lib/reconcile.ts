import type { DiffRow, DiffStatus, Product } from './types'

/**
 * 盘存比对引擎
 * 两种盘存方式（扫码 / 导入）最终都进入同一个比对函数。
 */

export interface ReconcileInput {
  /** 数据库当前库存（按 编号 聚合） */
  systemMap: Map<string, number>
  /** 扫描/导入得到的实际库存 */
  actualMap: Map<string, number>
  /** 产品元信息（名称、类别等），用于展示，可选 */
  productIndex?: Map<string, Product>
}

export function reconcile(input: ReconcileInput): DiffRow[] {
  const { systemMap, actualMap, productIndex } = input
  const codes = new Set<string>([...systemMap.keys(), ...actualMap.keys()])

  const details: DiffRow[] = []

  for (const code of codes) {
    const systemQty = systemMap.get(code) ?? 0
    const actualQty = actualMap.get(code) ?? 0
    const diff = actualQty - systemQty

    let status: DiffStatus
    if (diff === 0) {
      status = 'MATCH'
    } else if (diff < 0) {
      // 数据库多，实际少 -> 盘亏
      status = 'SYSTEM_MISSING'
    } else {
      // 实际多，数据库少 -> 盘盈
      status = 'SYSTEM_EXTRA'
    }

    const p = productIndex?.get(code)
    details.push({
      code,
      name: p?.name ?? '',
      category: p?.category ?? '',
      systemQty,
      actualQty,
      diff,
      status,
      gramWeight: p?.gram_weight ?? 0,
    })
  }

  // 稳定排序：异常优先（盘亏/盘盈），再按编号
  const rank = (s: DiffStatus) => (s === 'MATCH' ? 2 : s === 'SYSTEM_MISSING' ? 0 : 1)
  details.sort((a, b) => rank(a.status) - rank(b.status) || a.code.localeCompare(b.code, 'zh-CN'))
  return details
}

/** 由产品列表构建 编号 -> 数量 的系统库存 Map（同店） */
export function buildSystemMap(products: Product[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of products) m.set(p.code, p.qty)
  return m
}

/** 由产品列表构建 编号 -> 产品信息 索引 */
export function buildProductIndex(products: Product[]): Map<string, Product> {
  const m = new Map<string, Product>()
  for (const p of products) m.set(p.code, p)
  return m
}

/** 单件金额：优先用「总价 ÷ 数量」反推单价，否则用 克重×(克单价+克工费)+件工费 */
export function unitPrice(p: Product | undefined): number {
  if (!p) return 0
  if (p.qty > 0 && p.total_price > 0) return p.total_price / p.qty
  return (p.gram_weight || 0) * ((p.gram_price || 0) + (p.gram_fee || 0)) + (p.piece_fee || 0)
}

/** 按编号累加产品的 数量/克重/金额 汇总 */
export function sumByCode(
  map: Map<string, number>,
  productIndex?: Map<string, Product>,
): { qty: number; weight: number; amount: number } {
  let qty = 0
  let weight = 0
  let amount = 0
  for (const [code, n] of map) {
    const p = productIndex?.get(code)
    qty += n
    weight += (p?.gram_weight ?? 0) * n
    amount += unitPrice(p) * n
  }
  return { qty, weight, amount }
}
