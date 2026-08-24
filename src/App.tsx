import { useEffect, useMemo, useState } from 'react'
import { getCurrentStore, getStoreList, setCurrentStore } from '@/lib/store'
import ScanPage from '@/features/scan/ScanPage'
import ProductsPage from '@/features/products/ProductsPage'
import HistoryPage from '@/features/history/HistoryPage'
import SyncPage from '@/features/sync/SyncPage'
import SettingsPage from '@/features/settings/SettingsPage'

type Tab = 'scan' | 'products' | 'history' | 'sync' | 'settings'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'scan', label: '扫码盘存' },
  { key: 'products', label: '产品管理' },
  { key: 'history', label: '盘存历史' },
  { key: 'sync', label: '数据同步' },
  { key: 'settings', label: '门店设置' },
]

export default function App() {
  const [store, setStore] = useState<string>(getCurrentStore())
  const [stores, setStores] = useState<string[]>(getStoreList())
  const [tab, setTab] = useState<Tab>('scan')

  useEffect(() => {
    setStores(getStoreList())
  }, [])

  const selectStore = (name: string) => {
    setCurrentStore(name)
    setStore(name)
  }

  const refreshStores = () => setStores(getStoreList())

  const storeOptions = useMemo(
    () => Array.from(new Set([...stores, ...(store ? [store] : [])])),
    [stores, store],
  )

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
          <SettingsPage
            onStoreSelected={(name) => {
              selectStore(name)
              refreshStores()
              setTab('scan')
            }}
          />
        ) : (
          <>
            {tab === 'scan' && <ScanPage store={store} onStoresChanged={refreshStores} />}
            {tab === 'products' && <ProductsPage store={store} />}
            {tab === 'history' && <HistoryPage store={store} />}
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
