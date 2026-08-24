// 数据模型类型定义
// 与 Supabase 表结构保持一致，所有表统一加 mrpancun_ 前缀

/** 产品信息表 mrpancun_products，主键 (code, store) */
export interface Product {
  code: string // 产品编号
  store: string // 店名
  category: string // 类别
  name: string // 名称
  material: string // 材质
  qty: number // 当前库存数量
  gram_weight: number // 克重
  gram_price: number // 克单价
  total_price: number // 总价 = 克重 * 克单价 * 数量
  barcode: string // 条码（可选，扫码枪可能需要）
  updated_at: string // ISO 时间
}

/** 进出库日记表 mrpancun_inventory_journal，source_id 唯一防重复同步 */
export interface JournalEntry {
  source_id: string // 客户端生成唯一 id
  ts: string // ISO 时间
  product_code: string
  store: string
  direction: 'IN' | 'OUT'
  qty: number // 恒为正
  note: string
}

/** 每日实际盘存结果表 mrpancun_daily_inventory_snapshot，主键 (business_date, product_code, store) */
export interface DailySnapshot {
  business_date: string // YYYY-MM-DD（中国时区）
  product_code: string
  store: string
  actual_qty: number
  updated_at: string
}

/** 比对状态 */
export type DiffStatus = 'MATCH' | 'SYSTEM_MISSING' | 'SYSTEM_EXTRA'

/** 比对结果行（前端展示用） */
export interface DiffRow {
  code: string
  name: string
  category: string
  systemQty: number
  actualQty: number
  diff: number
  status: DiffStatus
}

/** 盘存确认参数 */
export interface ConfirmOptions {
  store: string
  businessDate: string // YYYY-MM-DD
  actualMap: Map<string, number>
  /** 是否同时调整库存（生成差异流水 + 更新产品数量） */
  adjustStock: boolean
}

export interface ConfirmResult {
  snapshotCount: number
  journalCount: number
  diffCount: number
  diffDetails: DiffRow[]
}
