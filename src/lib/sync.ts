// 统一同步逻辑：照片补齐 + 单店/全店同步 + 自动同步触发
import { getStoreList } from './store'
import { isDirty, clearDirty } from './dirty'
import { listJournal, listProducts, listSnapshots, upsertProduct } from './localDb'
import { syncDaily } from './supabase'
import { uploadProductPhoto } from './cos'
import type { Product } from './types'

let running = false

/**
 * 同步前补齐照片：有本地照片但还没有云端地址（photo_url）的产品，
 * 先上传到 COS 并写回本地，返回补齐后的产品列表。
 * 失败的产品保持原样，留待下次同步重试。
 */
async function preparePhotos(products: Product[]): Promise<Product[]> {
  const pending = products.filter((p) => p.photo && !p.photo_url && !p.deleted_at)
  if (pending.length === 0) return products

  const settled = await Promise.allSettled(
    pending.map((p) => uploadProductPhoto(p.store, p.code, p.photo as string)),
  )
  const fixed = new Map<string, Product>()
  pending.forEach((p, i) => {
    const r = settled[i]
    if (r.status === 'fulfilled' && r.value) {
      const next = { ...p, photo_url: r.value }
      fixed.set(`${p.code}\u0000${p.store}`, next)
      void upsertProduct(next)
    }
  })
  if (fixed.size === 0) return products
  return products.map((p) => fixed.get(`${p.code}\u0000${p.store}`) ?? p)
}

/** 同步单个门店（含照片补齐）；失败抛错 */
export async function syncOneStore(store: string): Promise<void> {
  const products = await preparePhotos(await listProducts(store, { includeDeleted: true }))
  const [journal, snapshots] = await Promise.all([listJournal(store), listSnapshots(store)])
  await syncDaily({ products, journal, snapshots })
}

/** 同步所有门店；全部成功后清除脏标记，返回成功门店数（单店失败不阻塞其它店） */
export async function syncAllStores(): Promise<number> {
  const stores = getStoreList()
  if (stores.length === 0) return 0
  let ok = 0
  for (const s of stores) {
    try {
      await syncOneStore(s)
      ok++
    } catch {
      // 单店失败，保留脏标记等待下次重试
    }
  }
  if (ok === stores.length) clearDirty()
  return ok
}

/** 自动同步入口（防重入）：有本地改动且未同步时才执行 */
export async function runAutoSync(): Promise<void> {
  if (running || !isDirty()) return
  running = true
  try {
    await syncAllStores()
  } finally {
    running = false
  }
}

/** 在 App 挂载时注册自动同步：启动、恢复联网、回到前台、定时检查；返回清理函数 */
export function setupAutoSync(): () => void {
  const trigger = () => void runAutoSync()
  const onOnline = () => window.setTimeout(trigger, 2000)
  const onVisible = () => {
    if (document.visibilityState === 'visible') window.setTimeout(trigger, 1500)
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  const timer = window.setInterval(trigger, 15 * 60 * 1000) // 每 15 分钟检查一次
  const boot = window.setTimeout(trigger, 3000) // 启动后稍作延迟首次尝试

  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
    window.clearInterval(timer)
    window.clearTimeout(boot)
  }
}
