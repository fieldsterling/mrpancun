// 今日金银价格工具：按材质识别金属种类，支持铂金/黄金/K金/白银 今日价设置
// 今日价存 localStorage（按门店隔离），用于在统计页按今日行情自动结算真实总价

export type MetalKind = 'platinum' | 'gold' | 'kgold' | 'silver'

export const METALS: Array<{ key: MetalKind; label: string }> = [
  { key: 'platinum', label: '铂金' },
  { key: 'gold', label: '黄金' },
  { key: 'kgold', label: 'K金' },
  { key: 'silver', label: '白银' },
]

export type MetalPrices = Partial<Record<MetalKind, number>>

const PRICE_KEY = (store: string) => `metal_prices_${store}`

export function loadMetalPrices(store: string): MetalPrices {
  try {
    const raw = localStorage.getItem(PRICE_KEY(store))
    return raw ? (JSON.parse(raw) as MetalPrices) : {}
  } catch {
    return {}
  }
}

export function saveMetalPrices(store: string, prices: MetalPrices): void {
  localStorage.setItem(PRICE_KEY(store), JSON.stringify(prices))
}

/** 识别材质属于哪类金属（铂优先，再银、K金，最后黄金；未识别返回 undefined） */
export function detectMetal(material: string | undefined): MetalKind | undefined {
  const m = (material ?? '').trim().toLowerCase()
  if (!m) return undefined
  // 铂金：铂 / Pt / Pt950 等
  if (m.includes('铂') || m.includes('pt')) return 'platinum'
  // 白银：银 / S925 / 925 / Ag
  if (m.includes('银') || m.includes('925') || m.includes('ag')) return 'silver'
  // K金：彩 / 750 / 585 / 916（Au750、G750、18K彩金 等，需先于 Au 命中）
  if (m.includes('彩') || m.includes('750') || m.includes('585') || m.includes('916')) return 'kgold'
  // 高纯黄金：999 / 千足 / 万足 / 24K / Au（Au999、足金999、24K金 等）
  if (m.includes('999') || m.includes('千足') || m.includes('万足') || m.includes('24k') || m.includes('au')) return 'gold'
  // 带 k 的合金：18K金 / 22K金 / 14K金 等
  if (m.includes('k')) return 'kgold'
  if (m.includes('金')) return 'gold'
  return undefined
}

/** 获取某材质的今日金属价（未设置今日价时回退到产品自身克单价） */
export function metalPriceFor(
  material: string | undefined,
  today: MetalPrices,
  fallback: number,
): number {
  const kind = detectMetal(material)
  if (kind && today[kind]) return today[kind] as number
  return fallback
}

/** 单件真实总价 = 克重×(今日金属价 + 克工费) + 件工费 */
export function realUnitPrice(p: {
  material?: string
  gram_weight?: number
  gram_price?: number
  gram_fee?: number
  piece_fee?: number
}, today: MetalPrices): number {
  const metal = metalPriceFor(p.material, today, p.gram_price || 0)
  return (p.gram_weight || 0) * (metal + (p.gram_fee || 0)) + (p.piece_fee || 0)
}
