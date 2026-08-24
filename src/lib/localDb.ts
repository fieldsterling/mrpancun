import Dexie, { type Table } from 'dexie'
import type { Product, JournalEntry, DailySnapshot } from './types'

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
}

/** 批量写入产品（用于导入，按主键 [code+store] upsert） */
export async function bulkUpsertProducts(products: Product[]): Promise<void> {
  if (products.length === 0) return
  await db.products.bulkPut(products)
}

export async function deleteProduct(code: string, store: string): Promise<void> {
  await db.products.delete([code, store])
}

export async function listProducts(store: string): Promise<Product[]> {
  return db.products.where('store').equals(store).sortBy('code')
}

export async function getProduct(code: string, store: string): Promise<Product | undefined> {
  return db.products.get([code, store])
}

/** 流水相关 */
export async function addJournal(entry: JournalEntry): Promise<void> {
  await db.journal.put(entry)
}

export async function listJournal(store: string): Promise<JournalEntry[]> {
  return db.journal.where('store').equals(store).reverse().sortBy('ts')
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
  return actualMap.size
}
