// 本地数据「脏」标记：任何本地写入后置位，自动同步成功后清除。
// 用于判断是否有未同步到云端的本地改动。

const DIRTY_KEY = 'mrpancun.dirty'

export function isDirty(): boolean {
  return localStorage.getItem(DIRTY_KEY) === '1'
}

export function markDirty(): void {
  localStorage.setItem(DIRTY_KEY, '1')
}

export function clearDirty(): void {
  localStorage.removeItem(DIRTY_KEY)
}
