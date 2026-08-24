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
  gram_price: number // 克单价（金属单价，元/克）
  gram_fee: number // 克工费（元/克）
  piece_fee: number // 件工费（元/件）
  total_price: number // 总价 = (克重×(克单价+克工费) + 件工费) × 数量
  barcode: string // 条码（可选，扫码枪可能需要）
  photo?: string // 产品照片（压缩后的 base64 dataURL，仅本地存储，不同步到 Supabase/COS）
  photo_thumb?: string // 缩略图（≤120px base64，列表用，仅本地）
  photo_url?: string // 照片云端地址（上传到 COS 后生成，随同步写入 Supabase）
  deleted_at?: string | null // 软删除标记（设置后列表默认隐藏，同步到云端）
  updated_at: string // ISO 时间（最后编辑时间）
  created_at: string // ISO 时间（首次入库时间，编辑不更新）
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
  /** 交易时的克单价（出库等场景记录，便于追溯当时的单价） */
  unit_price?: number
  /** 出库结算价（本次出库成交总金额，元） */
  settle_price?: number
  /** 出库客户（可选，用于结算追溯） */
  customer?: string
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
  /** 单件克重（用于克重/金额对账，来自产品表，可能为 0） */
  gramWeight: number
}

/** 盘存确认参数 */
export interface ConfirmOptions {
  store: string
  businessDate: string // YYYY-MM-DD
  actualMap: Map<string, number>
  /** 是否同时调整库存（生成差异流水 + 更新产品数量） */
  adjustStock: boolean
  /** 差异原因：编号 -> 原因（可选，写入流水 note） */
  reasons?: Record<string, string>
}

export interface ConfirmResult {
  snapshotCount: number
  journalCount: number
  diffCount: number
  diffDetails: DiffRow[]
}
