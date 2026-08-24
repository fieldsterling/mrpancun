import { useState } from 'react'
import { addStore, getStoreList, removeStore, setCurrentStore } from '@/lib/store'
import { isSupabaseReady } from '@/lib/supabase'
import { Modal, useToast } from '@/components/ui'

interface Props {
  store?: string
  onStoreSelected: (name: string) => void
  onStoresChanged?: () => void
}

export default function SettingsPage({ store, onStoreSelected, onStoresChanged }: Props) {
  const { show, node } = useToast()
  const [stores, setStores] = useState<string[]>(getStoreList())
  const [newStore, setNewStore] = useState('')
  const [storeToDelete, setStoreToDelete] = useState<string | null>(null)
  const [confirmName, setConfirmName] = useState('')

  const refresh = () => {
    setStores(getStoreList())
    onStoresChanged?.()
  }

  const add = () => {
    const name = newStore.trim()
    if (!name) {
      show('请输入门店名称', 'err')
      return
    }
    const list = addStore(name)
    setStores(list)
    setNewStore('')
    show(`已添加门店：${name}`, 'ok')
    onStoreSelected(name)
  }

  const select = (name: string) => {
    setCurrentStore(name)
    onStoreSelected(name)
    show(`已切换到 ${name}`, 'ok')
  }

  const doDelete = () => {
    if (!storeToDelete) return
    if (confirmName.trim() !== storeToDelete) {
      show('门店名称输入不一致，已取消删除', 'err')
      return
    }
    removeStore(storeToDelete)
    if (store === storeToDelete) onStoreSelected('')
    setStoreToDelete(null)
    setConfirmName('')
    refresh()
    show('门店已删除', 'ok')
  }

  const cosReady = Boolean(import.meta.env.VITE_COS_BUCKET)

  return (
    <>
      <section className="card">
        <div className="card-title">门店管理</div>
        {!store && (
          <div className="muted mb">
            当前未选择门店，请先添加或选择一个门店开始使用。
          </div>
        )}
        <div className="row mb">
          <input
            className="input"
            style={{ maxWidth: 240 }}
            placeholder="新门店名称，如 深圳店"
            value={newStore}
            onChange={(e) => setNewStore(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') add()
            }}
          />
          <button className="btn btn-primary" onClick={add}>
            添加门店
          </button>
        </div>

        {stores.length === 0 ? (
          <div className="empty">暂无门店，先添加一个吧</div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>门店</th>
                  <th>状态</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s}>
                    <td>{s}</td>
                    <td>{s === store ? <span className="tag">当前</span> : <span className="muted">—</span>}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        {s !== store && (
                          <button className="btn btn-sm" onClick={() => select(s)}>
                            切换
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => setStoreToDelete(s)}>
                          删除
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-title">环境配置状态</div>
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <span className={`tag ${isSupabaseReady() ? '' : ''}`}>
            Supabase：{isSupabaseReady() ? '已配置' : '未配置'}
          </span>
          <span className="tag">COS：{cosReady ? '已配置' : '未配置'}</span>
          <span className="tag">本地库：IndexedDB</span>
        </div>
        <div className="muted mt">
          密钥只存在于本机 .env（已 gitignore），不会提交仓库；生产环境 COS 走 Edge Function 代传，避免前端暴露永久密钥。
        </div>
      </section>

      {storeToDelete && (
        <Modal title={`删除门店「${storeToDelete}」`} onClose={() => setStoreToDelete(null)}>
          <div className="muted mb">
            删除后本地将不再显示该门店。请再次输入门店名称以确认：
          </div>
          <input
            className="input mb"
            placeholder={storeToDelete}
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
          />
          <div className="row">
            <button className="btn btn-danger" onClick={doDelete}>
              确认删除
            </button>
            <button className="btn" onClick={() => setStoreToDelete(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}

      {node}
    </>
  )
}
