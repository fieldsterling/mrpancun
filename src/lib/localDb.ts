import Dexie, { type Table } from 'dexie'
import type { Product, JournalEntry, DailySnapshot } from './types'
import { markDirty } from './dirty'

/**
 * 本地数据库（IndexedDB / Dexie）
 * 日常操作全部写本地，保证扫码与比对毫秒级响应；日终统一同步 Supabase。
 */
class InventoryDB extends Dexie {
  products!: Table<Product, [string, string]>
  journal!: Table<JournalEntry, string>
  snapshots!: Table<DailySnapshot, [string, string, string]>

  constructor() {
    super('mrpancun-inventory')
    this.version(1).stores({
      // 复合主键 [code+store]，避免多店同编号互相覆盖
      products: '[code+store], code, store, category, updated_at',
      journal: 'source_id, store, ts, [product_code+store]',
      snapshots: '[business_date+product_code+store], business_date, store, [business_date+store]',
    })
  }
}

export const db = new InventoryDB()

/** 产品相关 */
export async function upsertProduct(p: Product): Promise<void> {
  await db.products.put(p)
  markDirty()
}

/** 软删除：设置 deleted_at（记录保留，可恢复，同步时会把删除标记带到云端） */
export async function softDeleteProduct(code: string, store: string): Promise<void> {
  const now = new Date().toISOString()
  await db.products.update([code, store], { deleted_at: now, updated_at: now })
  markDirty()
}

/** 恢复软删除的产品 */
export async function restoreProduct(code: string, store: string): Promise<void> {
  const now = new Date().toISOString()
  await db.products.update([code, store], { deleted_at: null, updated_at: now })
  markDirty()
}

/** 彻底删除（不可恢复，一般不使用） */
export async function deleteProduct(code: string, store: string): Promise<void> {
  await db.products.delete([code, store])
  markDirty()
}

/**
 * 产品列表：默认排除软删除的产品；
 * includeDeleted=true 时返回全部（同步需要把删除标记带到云端）。
 */
export async function listProducts(
  store: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<Product[]> {
  const list = await db.products.where('store').equals(store).sortBy('code')
  return opts.includeDeleted ? list : list.filter((p) => !p.deleted_at)
}

export async function getProduct(code: string, store: string): Promise<Product | undefined> {
  return db.products.get([code, store])
}

/** 流水相关 */
export async function addJournal(entry: JournalEntry): Promise<void> {
  await db.journal.put(entry)
  markDirty()
}

/** 流水列表：按时间倒序（最新在前） */
export async function listJournal(store: string): Promise<JournalEntry[]> {
  const rows = await db.journal.where('store').equals(store).sortBy('ts')
  return rows.reverse()
}

/**
 * 导入产品并生成入库流水：
 * 按「新增数量」增量记流水（已存在则只记增量，重复导入不重复累计）。
 * 返回生成的流水条数。
 */
export async function importProductsWithJournal(products: Product[], note: string): Promise<number> {
  const now = new Date().toISOString()
  let journalCount = 0
  await db.transaction('rw', db.products, db.journal, async () => {
    for (const p of products) {
      const existing = await db.products.get([p.code, p.store])
      // 重复导入保留首次入库时间（created_at），只更新库存与其它字段
      await db.products.put({
        ...p,
        created_at: existing?.created_at ?? p.created_at ?? now,
      })
      const delta = Math.round((p.qty - (existing?.qty ?? 0)) * 1000) / 1000
      if (delta > 0) {
        await db.journal.put({
          source_id: crypto.randomUUID(),
          ts: now,
          product_code: p.code,
          store: p.store,
          direction: 'IN',
          qty: delta,
          note,
          unit_price: p.gram_price || 0,
        })
        journalCount++
      }
    }
  })
  markDirty()
  return journalCount
}

/** 出库：写 OUT 流水 + 扣减库存（原子操作） */
export async function stockOut(entry: JournalEntry, product: Product): Promise<void> {
  const now = new Date().toISOString()
  await db.transaction('rw', db.journal, db.products, async () => {
    await db.journal.put(entry)
    await db.products.put({ ...product, qty: Math.max(0, product.qty - entry.qty), updated_at: now })
  })
  markDirty()
}

/** 快照相关 */
export async function listSnapshots(store: string): Promise<DailySnapshot[]> {
  return db.snapshots.where('store').equals(store).toArray()
}

export async function listSnapshotsByDate(businessDate: string, store: string): Promise<DailySnapshot[]> {
  return db.snapshots.where('[business_date+store]').equals([businessDate, store]).toArray()
}

/**
 * 表3「当天最后一次确认覆盖」逻辑：
 * 同一天、同一门店先删除旧快照，再写入本次完整结果，避免二次确认残留。
 */
export async function replaceSnapshots(
  businessDate: string,
  store: string,
  actualMap: Map<string, number>,
  now: string,
): Promise<number> {
  await db.transaction('rw', db.snapshots, async () => {
    await db.snapshots
      .where('[business_date+store]')
      .equals([businessDate, store])
      .delete()

    const rows: DailySnapshot[] = []
    for (const [product_code, actual_qty] of actualMap) {
      rows.push({ business_date: businessDate, product_code, store, actual_qty, updated_at: now })
    }
    if (rows.length > 0) await db.snapshots.bulkAdd(rows)
  })
  markDirty()
  return actualMap.size
}
