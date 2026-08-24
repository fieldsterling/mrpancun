import { useCallback, useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { listJournal, listProducts, listSnapshots } from '@/lib/localDb'
import { backupToCos } from '@/lib/cos'
import { getSessionUser, isSupabaseReady, signIn, signOut, supabase, syncDaily } from '@/lib/supabase'
import { formatCN, todayCN } from '@/lib/date'
import { useToast } from '@/components/ui'

interface Props {
  store: string
}

const LAST_SYNC_KEY = 'mrpancun.lastSync'

export default function SyncPage({ store }: Props) {
  const { show, node } = useToast()
  const [counts, setCounts] = useState<{ products: number; journal: number; snapshots: number } | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [backing, setBacking] = useState(false)
  const [user, setUser] = useState<User | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [lastSync, setLastSync] = useState<string>(() => localStorage.getItem(LAST_SYNC_KEY) ?? '')

  const loadCounts = useCallback(async () => {
    setCounts(null)
    const [products, journal, snapshots] = await Promise.all([
      listProducts(store),
      listJournal(store),
      listSnapshots(store),
    ])
    setCounts({ products: products.length, journal: journal.length, snapshots: snapshots.length })
  }, [store])

  useEffect(() => {
    void loadCounts()
  }, [loadCounts])

  useEffect(() => {
    void getSessionUser().then(setUser)
  }, [])

  const onSync = async () => {
    setSyncing(true)
    try {
      const [products, journal, snapshots] = await Promise.all([
        listProducts(store),
        listJournal(store),
        listSnapshots(store),
      ])
      await syncDaily({ products, journal, snapshots })
      const t = new Date().toISOString()
      localStorage.setItem(LAST_SYNC_KEY, t)
      setLastSync(t)
      show('已同步到 Supabase', 'ok')
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setSyncing(false)
    }
  }

  const onBackup = async () => {
    setBacking(true)
    try {
      const [products, journal, snapshots] = await Promise.all([
        listProducts(store),
        listJournal(store),
        listSnapshots(store),
      ])
      const result = await backupToCos({
        store,
        businessDate: todayCN(),
        products,
        journal,
        snapshots,
      })
      show(`已备份到 COS（${result.via === 'direct' ? '直传' : 'Edge Function'}）`, 'ok')
    } catch (e) {
      show((e as Error).message, 'err')
    } finally {
      setBacking(false)
    }
  }

  const onSignIn = async () => {
    try {
      const u = await signIn(email.trim(), password)
      setUser(u)
      setPassword('')
      show('登录成功', 'ok')
    } catch (e) {
      show((e as Error).message, 'err')
    }
  }

  const onSignOut = async () => {
    await signOut()
    setUser(null)
    show('已退出登录', 'info')
  }

  return (
    <>
      <section className="card">
        <div className="card-title">本地数据概览 · {store}</div>
        {counts === null ? (
          <div className="muted">统计中…</div>
        ) : (
          <div className="stats">
            <div className="stat">
              <div className="num">{counts.products}</div>
              <div className="lbl">产品</div>
            </div>
            <div className="stat">
              <div className="num">{counts.journal}</div>
              <div className="lbl">进出库流水</div>
            </div>
            <div className="stat">
              <div className="num">{counts.snapshots}</div>
              <div className="lbl">盘存快照</div>
            </div>
          </div>
        )}
        {lastSync && (
          <div className="muted mt">上次同步：{formatCN(lastSync)}（本地时间）</div>
        )}
      </section>

      <section className="card">
        <div className="card-title">同步到 Supabase</div>
        <div className="muted mb">
          日常操作在本地完成，日终点击下方按钮把三张表（
          <code>mrpancun_products</code> / <code>mrpancun_inventory_journal</code> /{' '}
          <code>mrpancun_daily_inventory_snapshot</code>）批量上传。
          {isSupabaseReady() ? ' Supabase 已配置。' : ' Supabase 未配置，请检查 .env。'}
        </div>
        <div className="row">
          <button className="btn btn-primary" disabled={syncing || !isSupabaseReady()} onClick={() => void onSync()}>
            {syncing ? '同步中…' : '立即同步'}
          </button>
          <button className="btn" disabled={backing} onClick={() => void onBackup()}>
            {backing ? '备份中…' : '备份快照到 COS'}
          </button>
        </div>
        <div className="muted mt">
          提示：需要先在 Supabase 部署 <code>sync-daily</code> 与 <code>backup-cos</code> Edge Function，
          并执行 <code>001_schema.sql</code> 建表（详见 supabase/ 目录说明）。
        </div>
      </section>

      <section className="card">
        <div className="card-title">账号（可选）</div>
        {user ? (
          <div className="row">
            <span className="muted">已登录：{user.email}</span>
            <button className="btn btn-sm" onClick={() => void onSignOut()}>
              退出登录
            </button>
          </div>
        ) : supabase ? (
          <div className="row">
            <input className="input" style={{ maxWidth: 220 }} placeholder="邮箱" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="input" style={{ maxWidth: 220 }} type="password" placeholder="密码" value={password} onChange={(e) => setPassword(e.target.value)} />
            <button className="btn" onClick={() => void onSignIn()}>
              登录
            </button>
          </div>
        ) : (
          <div className="muted">Supabase 未配置，无法使用账号登录。</div>
        )}
      </section>

      {node}
    </>
  )
}
