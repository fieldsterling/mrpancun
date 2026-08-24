import { db, replaceSnapshots } from './localDb'
import { buildProductIndex, buildSystemMap, reconcile } from './reconcile'
import type { ConfirmOptions, ConfirmResult } from './types'

/**
 * 盘存确认服务
 * 1. 写表3（当天该门店快照覆盖）
 * 2. 计算差异
 * 3. 可选：生成差异流水(表2) + 更新产品库存(表1)，保证 当前库存 = 期初 + IN - OUT 可审计
 */
export async function confirmInventory(opts: ConfirmOptions): Promise<ConfirmResult> {
  const { store, businessDate, actualMap, adjustStock } = opts
  const now = new Date().toISOString()

  const products = await db.products.where('store').equals(store).toArray()
  const systemMap = buildSystemMap(products)
  const productIndex = buildProductIndex(products)

  // 1. 写表3（当天最后一次确认覆盖）
  const snapshotCount = await replaceSnapshots(businessDate, store, actualMap, now)

  // 2. 计算差异
  const details = reconcile({ systemMap, actualMap, productIndex })
  const diffDetails = details.filter((d) => d.status !== 'MATCH')

  // 3. 可选：调整库存
  let journalCount = 0
  if (adjustStock) {
    await db.transaction('rw', db.journal, db.products, async () => {
      for (const d of diffDetails) {
        const direction = d.diff > 0 ? ('IN' as const) : ('OUT' as const)
        await db.journal.put({
          source_id: crypto.randomUUID(),
          ts: now,
          product_code: d.code,
          store,
          direction,
          qty: Math.abs(d.diff),
          note: `盘存调整 ${businessDate}`,
        })
        journalCount++

        const product = productIndex.get(d.code)
        if (product) {
          await db.products.put({ ...product, qty: d.actualQty, updated_at: now })
        }
      }
    })
  }

  return { snapshotCount, journalCount, diffCount: diffDetails.length, diffDetails }
}
