import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import type { Product, JournalEntry, DailySnapshot } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

/** Supabase 客户端；未配置时为 null（应用仍可本地离线使用） */
export const supabase: SupabaseClient | null =
  url && anonKey ? createClient(url, anonKey) : null

export function isSupabaseReady(): boolean {
  return supabase !== null
}

/** 日终同步数据载荷 */
export interface SyncPayload {
  products: Product[]
  journal: JournalEntry[]
  snapshots: DailySnapshot[]
}

/**
 * 调用 Edge Function `sync-daily` 批量 upsert 三张表。
 * 需要先在 Supabase 部署该函数（见 supabase/functions/sync-daily）。
 */
export async function syncDaily(payload: SyncPayload): Promise<{ ok: boolean }> {
  if (!supabase) throw new Error('未配置 Supabase，无法同步')
  // 照片 base64（photo / photo_thumb）仅本地存储，同步时剔除；
  // photo_url（云端地址）、deleted_at（软删除标记）、customer（出库客户）正常上传。
  const products = payload.products.map(({ photo: _photo, photo_thumb: _thumb, ...rest }) => rest)
  const { data, error } = await supabase.functions.invoke('sync-daily', {
    body: { ...payload, products },
  })
  if (error) throw new Error(`同步失败：${error.message}`)
  return data as { ok: boolean }
}

/** 认证：邮箱密码登录（可选能力，不强制） */
export async function signIn(email: string, password: string): Promise<User | null> {
  if (!supabase) return null
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw new Error(error.message)
  return data.user
}

export async function signOut(): Promise<void> {
  await supabase?.auth.signOut()
}

export async function getSessionUser(): Promise<User | null> {
  const { data } = await supabase?.auth.getUser() ?? { data: { user: null } }
  return data.user
}
