import { useEffect, useMemo, useState } from 'react'
import { getCurrentStore, getStoreList, setCurrentStore } from '@/lib/store'
import { setupAutoSync } from '@/lib/sync'
import ScanPage from '@/features/scan/ScanPage'
import ProductsPage from '@/features/products/ProductsPage'
import HistoryPage from '@/features/history/HistoryPage'
import JournalPage from '@/features/journal/JournalPage'
import StatsPage from '@/features/stats/StatsPage'
import SettlementPage from '@/features/settle/SettlementPage'
import GuidePage from '@/features/onboard/GuidePage'
import SyncPage from '@/features/sync/SyncPage'
import SettingsPage from '@/features/settings/SettingsPage'
import ProductDetailPage from '@/features/products/ProductDetailPage'

type Tab = 'guide' | 'products' | 'scan' | 'history' | 'journal' | 'stats' | 'settle' | 'sync' | 'settings'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'guide', label: '新手引导' },
  { key: 'products', label: '产品管理' },
  { key: 'scan', label: '扫码盘存' },
  { key: 'history', label: '盘存历史' },
  { key: 'journal', label: '流水明细' },
  { key: 'stats', label: '库存统计' },
  { key: 'settle', label: '出库结算' },
  { key: 'sync', label: '数据同步' },
  { key: 'settings', label: '门店设置' },
]

export default function App() {
  const [store, setStore] = useState<string>(getCurrentStore())
  const [stores, setStores] = useState<string[]>(getStoreList())
  const [tab, setTab] = useState<Tab>('scan')
  // 分享链接直达：?store=xxx&code=yyy&gp=实时克单价(可选)
  const [share, setShare] = useState<{ store: string; code: string; price?: number } | null>(() => {
    const s = new URLSearchParams(window.location.search)
    const store = s.get('store')
    const code = s.get('code')
    if (!store || !code) return null
    const raw = s.get('gp')
    const price = raw ? Number(raw) : NaN
    return { store, code, price: Number.isFinite(price) && price > 0 ? price : undefined }
  })

  const closeShare = () => {
    setShare(null)
    const u = new URL(window.location.href)
    u.searchParams.delete('store')
    u.searchParams.delete('code')
    u.searchParams.delete('gp')
    window.history.replaceState(null, '', u.pathname + u.search)
  }

  useEffect(() => {
    setStores(getStoreList())
  }, [])

  // 注册自动同步：启动/联网/回到前台/定时检查本地脏标记并同步
  useEffect(() => setupAutoSync(), [])

  const selectStore = (name: string) => {
    setCurrentStore(name)
    setStore(name)
  }

  const refreshStores = () => setStores(getStoreList())

  const storeOptions = useMemo(
    () => Array.from(new Set([...stores, ...(store ? [store] : [])])),
    [stores, store],
  )

  // 分享链接直达：直接渲染独立产品详情页（不显示主界面）
  if (share) {
    return (
      <ProductDetailPage
        store={share.store}
        code={share.code}
        price={share.price}
        onClose={closeShare}
      />
    )
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">金</span>
          <span>金店每日盘存</span>
        </div>
        <div className="topbar-right">
          <select
            className="select"
            style={{ width: 'auto' }}
            value={store}
            onChange={(e) => selectStore(e.target.value)}
          >
            <option value="" disabled>
              选择门店
            </option>
            {storeOptions.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
      </header>

      <nav className="nav">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`nav-btn ${tab === t.key ? 'active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main>
        {!store ? (
          <GuidePage
            store={store}
            onStoreSelected={(name) => {
              selectStore(name)
              refreshStores()
            }}
            onStoresChanged={refreshStores}
            onGo={(t) => setTab(t as Tab)}
          />
        ) : (
          <>
            {tab === 'guide' && (
              <GuidePage
                store={store}
                onStoreSelected={selectStore}
                onStoresChanged={refreshStores}
                onGo={(t) => setTab(t as Tab)}
              />
            )}
            {tab === 'scan' && <ScanPage store={store} onStoresChanged={refreshStores} />}
            {tab === 'products' && <ProductsPage store={store} />}
            {tab === 'history' && <HistoryPage store={store} />}
            {tab === 'journal' && <JournalPage store={store} />}
            {tab === 'stats' && <StatsPage store={store} />}
            {tab === 'settle' && <SettlementPage store={store} />}
            {tab === 'sync' && <SyncPage store={store} />}
            {tab === 'settings' && (
              <SettingsPage
                store={store}
                onStoreSelected={selectStore}
                onStoresChanged={refreshStores}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
