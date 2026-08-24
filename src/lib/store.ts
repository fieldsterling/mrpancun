// 门店设置：当前门店 + 门店列表，持久化到 localStorage

const KEY = 'mrpancun.store'
const LIST_KEY = 'mrpancun.stores'

export function getCurrentStore(): string {
  return localStorage.getItem(KEY) ?? ''
}

export function setCurrentStore(name: string): void {
  localStorage.setItem(KEY, name)
}

export function getStoreList(): string[] {
  try {
    const raw = localStorage.getItem(LIST_KEY)
    const arr = raw ? (JSON.parse(raw) as string[]) : []
    return Array.from(new Set(arr))
  } catch {
    return []
  }
}

export function addStore(name: string): string[] {
  const nameTrim = name.trim()
  if (!nameTrim) return getStoreList()
  const list = getStoreList()
  if (!list.includes(nameTrim)) list.push(nameTrim)
  localStorage.setItem(LIST_KEY, JSON.stringify(list))
  return list
}

export function removeStore(name: string): string[] {
  const list = getStoreList().filter((s) => s !== name)
  localStorage.setItem(LIST_KEY, JSON.stringify(list))
  return list
}
