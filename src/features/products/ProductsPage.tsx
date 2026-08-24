import { useCallback, useEffect, useMemo, useState } from 'react'
import { deleteProduct, listProducts, upsertProduct } from '@/lib/localDb'
import type { Product } from '@/lib/types'
import { Empty, Modal, Skeleton, useToast } from '@/components/ui'
import ImportProductsModal from './ImportProductsModal'

interface Props {
  store: string
}

const emptyForm = (store: string): Product => ({
  code: '',
  store,
  category: '',
  name: '',
  material: '',
  qty: 0,
  gram_weight: 0,
  gram_price: 0,
  total_price: 0,
  barcode: '',
  updated_at: new Date().toISOString(),
})

export default function ProductsPage({ store }: Props) {
  const { show, node } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)

  const load = useCallback(async () => {
    setProducts(null)
    setProducts(await listProducts(store))
  }, [store])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!products) return []
    const q = query.trim().toLowerCase()
    if (!q) return products
    return products.filter((p) =>
      [p.code, p.name, p.category, p.material, p.barcode].some((v) =>
        v.toLowerCase().includes(q),
      ),
    )
  }, [products, query])

  const openNew = () => {
    setIsNew(true)
    setEditing(emptyForm(store))
  }

  const openEdit = (p: Product) => {
    setIsNew(false)
    setEditing({ ...p })
  }

  const save = async () => {
    if (!editing) return
    if (!editing.code.trim()) {
      show('产品编号不能为空', 'err')
      return
    }
    setSaving(true)
    try {
      const total =
        editing.gram_weight * editing.gram_price * editing.qty || 0
      await upsertProduct({
        ...editing,
        code: editing.code.trim(),
        total_price: Math.round(total * 100) / 100,
        updated_at: new Date().toISOString(),
      })
      setEditing(null)
      await load()
      show(isNew ? '已新增产品' : '已保存修改', 'ok')
    } catch (e) {
      show(`保存失败：${(e as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  const remove = async (p: Product) => {
    if (!window.confirm(`确定删除产品 ${p.code}（${p.name}）？`)) return
    try {
      await deleteProduct(p.code, p.store)
      await load()
      show('已删除', 'ok')
    } catch (e) {
      show(`删除失败：${(e as Error).message}`, 'err')
    }
  }

  const setField = (k: keyof Product, v: string | number) => {
    if (!editing) return
    setEditing({ ...editing, [k]: v })
  }

  const total = (editing?.gram_weight ?? 0) * (editing?.gram_price ?? 0) * (editing?.qty ?? 0)

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div className="card-title" style={{ margin: 0 }}>
            产品管理 · {store}
          </div>
          <span className="row" style={{ gap: 8 }}>
            <button className="btn" onClick={() => setShowImport(true)}>
              导入产品
            </button>
            <button className="btn btn-primary" onClick={openNew}>
              新增产品
            </button>
          </span>
        </div>
        <div className="mt">
          <input
            className="input"
            placeholder="搜索编号 / 名称 / 类别 / 材质 / 条码"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </section>

      <section className="card">
        {products === null ? (
          <Skeleton lines={6} />
        ) : filtered.length === 0 ? (
          <Empty text={query ? '未找到匹配产品' : '暂无产品，点击「新增产品」开始添加'} />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>编号</th>
                  <th>名称</th>
                  <th>类别</th>
                  <th>材质</th>
                  <th className="t-num">数量</th>
                  <th className="t-num">克重</th>
                  <th className="t-num">克单价</th>
                  <th className="t-num">总价</th>
                  <th>条码</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.code}>
                    <td>{p.code}</td>
                    <td>{p.name || <span className="muted">—</span>}</td>
                    <td>{p.category || <span className="muted">—</span>}</td>
                    <td>{p.material || <span className="muted">—</span>}</td>
                    <td className="t-num">{p.qty}</td>
                    <td className="t-num">{p.gram_weight}</td>
                    <td className="t-num">{p.gram_price}</td>
                    <td className="t-num">{p.total_price.toLocaleString('zh-CN')}</td>
                    <td>{p.barcode || <span className="muted">—</span>}</td>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <button className="btn btn-sm" onClick={() => openEdit(p)}>
                          编辑
                        </button>
                        <button className="btn btn-sm btn-danger" onClick={() => void remove(p)}>
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

      {editing && (
        <Modal title={isNew ? '新增产品' : `编辑产品 · ${editing.code}`} onClose={() => setEditing(null)}>
          <div className="field">
            <label>产品编号 *</label>
            <input
              className="input"
              value={editing.code}
              disabled={!isNew}
              onChange={(e) => setField('code', e.target.value)}
              placeholder="如 P001"
            />
          </div>
          <div className="field">
            <label>名称</label>
            <input className="input" value={editing.name} onChange={(e) => setField('name', e.target.value)} placeholder="如 足金手镯" />
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>类别</label>
              <input className="input" value={editing.category} onChange={(e) => setField('category', e.target.value)} placeholder="如 黄金" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>材质</label>
              <input className="input" value={editing.material} onChange={(e) => setField('material', e.target.value)} placeholder="如 Au999" />
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ flex: 1 }}>
              <label>数量</label>
              <input className="input" type="number" min={0} value={editing.qty} onChange={(e) => setField('qty', Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>克重</label>
              <input className="input" type="number" min={0} value={editing.gram_weight} onChange={(e) => setField('gram_weight', Number(e.target.value))} />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>克单价</label>
              <input className="input" type="number" min={0} value={editing.gram_price} onChange={(e) => setField('gram_price', Number(e.target.value))} />
            </div>
          </div>
          <div className="field">
            <label>总价（克重 × 克单价 × 数量，自动计算）</label>
            <input className="input" value={Math.round(total * 100) / 100} readOnly />
          </div>
          <div className="field">
            <label>条码（可选）</label>
            <input className="input" value={editing.barcode} onChange={(e) => setField('barcode', e.target.value)} placeholder="如 6901234567890" />
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
              {saving ? '保存中…' : '保存'}
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </Modal>
      )}

      {showImport && (
        <ImportProductsModal
          store={store}
          onClose={() => setShowImport(false)}
          onImported={() => void load()}
        />
      )}

      {node}
    </>
  )
}
