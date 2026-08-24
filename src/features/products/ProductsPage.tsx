import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addJournal,
  listProducts,
  softDeleteProduct,
  upsertProduct,
} from '@/lib/localDb'
import { todayCN } from '@/lib/date'
import type { Product } from '@/lib/types'
import { Empty, Modal, Skeleton, useToast } from '@/components/ui'
import { copyText } from '@/lib/clipboard'
import { uploadProductPhoto } from '@/lib/cos'
import ImportProductsModal from './ImportProductsModal'
import OutboundModal from './OutboundModal'

interface Props {
  store: string
}

/** 读取图片文件 → 生成高清图（≤900px）与缩略图（≤120px） */
function processPhoto(file: File): Promise<{ photo: string; photo_thumb: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('读取图片失败'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('图片解析失败'))
      img.onload = () => {
        const toDataUrl = (max: number, quality: number): string => {
          const scale = Math.min(1, max / Math.max(img.width, img.height))
          const w = Math.max(1, Math.round(img.width * scale))
          const h = Math.max(1, Math.round(img.height * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('无法处理图片')
          ctx.fillStyle = '#fff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          return canvas.toDataURL('image/jpeg', quality)
        }
        try {
          resolve({ photo: toDataUrl(900, 0.82), photo_thumb: toDataUrl(120, 0.6) })
        } catch (e) {
          reject(e as Error)
        }
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
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
  gram_fee: 0,
  piece_fee: 0,
  total_price: 0,
  barcode: '',
  updated_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
})

export default function ProductsPage({ store }: Props) {
  const { show, node } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showOut, setShowOut] = useState(false)
  // 每行「出库」时预选的产品编号（顶部「出库产品」按钮打开时不预选）
  const [outCode, setOutCode] = useState<string | undefined>()
  const photoRef = useRef<HTMLInputElement>(null)
  // 分享前设置实时克单价
  const [shareTarget, setShareTarget] = useState<Product | null>(null)
  const [sharePrice, setSharePrice] = useState('')
  // 视图模式：列表 / 纯图（默认列表）
  const [viewMode, setViewMode] = useState<'list' | 'grid'>('list')

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
    const list = q
      ? products.filter((p) =>
          [p.code, p.name, p.category, p.material, p.barcode].some((v) =>
            v.toLowerCase().includes(q),
          ),
        )
      : products
    // 按名称字母顺序排序，同名按克重升序；无名称的排最后
    return [...list].sort((a, b) => {
      const an = a.name || ''
      const bn = b.name || ''
      if (an && bn) {
        const c = an.localeCompare(bn, 'zh-CN')
        if (c !== 0) return c
      } else if (an) return -1
      else if (bn) return 1
      return (a.gram_weight || 0) - (b.gram_weight || 0)
    })
  }, [products, query])

  const openNew = () => {
    setIsNew(true)
    setEditing(emptyForm(store))
  }

  const openEdit = (p: Product) => {
    setIsNew(false)
    setEditing({ ...p })
  }

  /** 入库：打开「新增产品」对话框并预填当前产品信息，可调整数量后保存入库 */
  const stockIn = (p: Product) => {
    setIsNew(true)
    setEditing({ ...p })
  }

  /** 出库：打开出库对话框并预选该产品 */
  const openOut = (p: Product) => {
    setOutCode(p.code)
    setShowOut(true)
  }

  const save = async () => {
    if (!editing) return
    if (!editing.code.trim()) {
      show('产品编号不能为空', 'err')
      return
    }
    setSaving(true)
    try {
      // 总价 = (克重 × (克单价 + 克工费) + 件工费) × 数量
      const perUnit =
        (editing.gram_weight || 0) * ((editing.gram_price || 0) + (editing.gram_fee || 0)) +
        (editing.piece_fee || 0)
      const total = perUnit * (editing.qty || 0)
      const next: Product = {
        ...editing,
        code: editing.code.trim(),
        total_price: Math.round(total * 100) / 100,
        updated_at: new Date().toISOString(),
      }
      await upsertProduct(next)
      // 有本地照片但还没上传云端 → 尝试上传（失败不阻塞保存，下次同步自动补传）
      if (next.photo && !next.photo_url) {
        try {
          const url = await uploadProductPhoto(next.store, next.code, next.photo)
          await upsertProduct({ ...next, photo_url: url })
        } catch {
          // 离线等情况，忽略
        }
      }
      // 新增产品写入入库流水（编辑不记）
      if (isNew && next.qty > 0) {
        await addJournal({
          source_id: crypto.randomUUID(),
          ts: next.updated_at,
          product_code: next.code,
          store,
          direction: 'IN',
          qty: next.qty,
          note: `新增产品 ${todayCN()}`,
          unit_price: next.gram_price || 0,
        })
      }
      setEditing(null)
      await load()
      show(isNew ? '已新增产品' : '已保存修改', 'ok')
    } catch (e) {
      show(`保存失败：${(e as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  /** 软删除：记录保留（可恢复），同步时把删除标记带到云端 */
  const remove = async (p: Product) => {
    if (!window.confirm(`确定删除产品 ${p.code}（${p.name}）？删除后可随时恢复。`)) return
    try {
      await softDeleteProduct(p.code, p.store)
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

  /** 选择照片 → 生成高清图+缩略图；换图后清空云端地址，待重新上传 */
  const onPickPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file || !editing) return
    try {
      const { photo, photo_thumb } = await processPhoto(file)
      setEditing({ ...editing, photo, photo_thumb, photo_url: '' })
    } catch (err) {
      show(`照片处理失败：${(err as Error).message}`, 'err')
    }
  }

  /** 点击分享 → 先弹出实时克单价设置窗口，确认后生成链接并复制 */
  const onShare = (p: Product) => {
    setSharePrice(String(p.gram_price || ''))
    setShareTarget(p)
  }

  const doShare = async () => {
    if (!shareTarget) return
    const u = new URL(window.location.href)
    u.searchParams.set('store', shareTarget.store)
    u.searchParams.set('code', shareTarget.code)
    const v = Number(sharePrice)
    if (Number.isFinite(v) && v > 0) u.searchParams.set('gp', String(v))
    const ok = await copyText(u.toString())
    setShareTarget(null)
    show(
      ok ? '产品链接已复制，粘贴到浏览器打开即可查看详情页' : '复制失败，请手动复制浏览器地址栏链接',
      ok ? 'ok' : 'err',
    )
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
            <span className="view-toggle">
              <button
                className={`btn btn-sm ${viewMode === 'list' ? 'btn-primary' : ''}`}
                onClick={() => setViewMode('list')}
              >
                列表
              </button>
              <button
                className={`btn btn-sm ${viewMode === 'grid' ? 'btn-primary' : ''}`}
                onClick={() => setViewMode('grid')}
              >
                纯图
              </button>
            </span>
            <button className="btn" onClick={() => setShowImport(true)}>
              导入产品
            </button>
            <button
              className="btn"
              onClick={() => {
                setOutCode(undefined)
                setShowOut(true)
              }}
            >
              出库产品
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
        ) : viewMode === 'grid' ? (
          <div className="prod-grid">
            {filtered.map((p) => (
              <div key={p.code} className="prod-grid-item">
                {p.photo_thumb || p.photo ? (
                  <img src={p.photo_thumb || p.photo} alt={p.name || p.code} loading="lazy" />
                ) : (
                  <div className="prod-grid-empty">—</div>
                )}
                <span className="prod-grid-actions prod-grid-actions-top">
                  <button className="btn" onClick={() => stockIn(p)}>
                    入库
                  </button>
                  <button className="btn" onClick={() => openOut(p)}>
                    出库
                  </button>
                </span>
                <span className="prod-grid-actions prod-grid-actions-bottom">
                  <button className="btn" onClick={() => openEdit(p)}>
                    编辑
                  </button>
                  <button className="btn" onClick={() => onShare(p)}>
                    分享
                  </button>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>照片</th>
                  <th>编号</th>
                  <th>名称</th>
                  <th>类别</th>
                  <th>材质</th>
                  <th className="t-num">数量</th>
                  <th className="t-num">克重</th>
                  <th className="t-num">克单价</th>
                  <th className="t-num">克工费</th>
                  <th className="t-num">件工费</th>
                  <th className="t-num">总价</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => (
                  <tr key={p.code}>
                    <td>
                      {p.photo_thumb || p.photo ? (
                        <img
                          src={p.photo_thumb || p.photo}
                          alt={p.name || p.code}
                          className="thumb"
                          loading="lazy"
                        />
                      ) : (
                        <span className="thumb thumb-empty">—</span>
                      )}
                    </td>
                    <td>{p.code}</td>
                    <td>{p.name || <span className="muted">—</span>}</td>
                    <td>{p.category || <span className="muted">—</span>}</td>
                    <td>{p.material || <span className="muted">—</span>}</td>
                    <td className="t-num">{p.qty}</td>
                    <td className="t-num">{p.gram_weight}</td>
                    <td className="t-num">{p.gram_price}</td>
                    <td className="t-num">{p.gram_fee || 0}</td>
                    <td className="t-num">{p.piece_fee || 0}</td>
                    <td className="t-num">{p.total_price.toLocaleString('zh-CN')}</td>
                    <td>
                      <span className="action-col">
                        <button className="btn btn-sm" onClick={() => onShare(p)}>
                          分享
                        </button>
                        <span className="action-row">
                          <button className="btn btn-sm" onClick={() => stockIn(p)}>
                            入库
                          </button>
                          <button className="btn btn-sm" onClick={() => openOut(p)}>
                            出库
                          </button>
                        </span>
                        <span className="action-row">
                          <button className="btn btn-sm" onClick={() => openEdit(p)}>
                            编辑
                          </button>
                          <button className="btn btn-sm btn-danger" onClick={() => void remove(p)}>
                            删除
                          </button>
                        </span>
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
            <label>产品照片（可选，1 张）</label>
            <div className="photo-upload">
              {editing.photo ? (
                <div className="photo-edit">
                  <img src={editing.photo} alt="产品照片" className="photo-preview" />
                  <span className="row" style={{ gap: 8 }}>
                    <button type="button" className="btn btn-sm" onClick={() => photoRef.current?.click()}>
                      更换
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => setField('photo', '')}
                    >
                      删除
                    </button>
                  </span>
                </div>
              ) : (
                <button type="button" className="photo-placeholder" onClick={() => photoRef.current?.click()}>
                  <span className="photo-plus">＋</span>
                  <span>点击上传照片</span>
                  <span className="muted">支持 JPG / PNG，保存时自动压缩</span>
                </button>
              )}
              <input
                ref={photoRef}
                type="file"
                accept="image/*"
                hidden
                onChange={(e) => void onPickPhoto(e)}
              />
            </div>
          </div>
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
            <div className="field" style={{ flex: 1 }}>
              <label>克工费</label>
              <input className="input" type="number" min={0} value={editing.gram_fee} onChange={(e) => setField('gram_fee', Number(e.target.value))} placeholder="元/克" />
            </div>
            <div className="field" style={{ flex: 1 }}>
              <label>件工费</label>
              <input className="input" type="number" min={0} value={editing.piece_fee} onChange={(e) => setField('piece_fee', Number(e.target.value))} placeholder="元/件" />
            </div>
          </div>
          <div className="field">
            <label>总价（(克重 × (克单价 + 克工费) + 件工费) × 数量，自动计算）</label>
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

      {shareTarget && (
        <Modal
          title={`分享产品 · ${shareTarget.name || shareTarget.code}`}
          onClose={() => setShareTarget(null)}
        >
          <div className="share-preview">
            {shareTarget.photo ? (
              <img src={shareTarget.photo} alt={shareTarget.name || shareTarget.code} className="share-photo" />
            ) : (
              <div className="share-photo share-photo-empty">◆</div>
            )}
            <div>
              <div className="share-name">{shareTarget.name || '未命名产品'}</div>
              <div className="muted">
                编号 {shareTarget.code} · 克重 {shareTarget.gram_weight} g
              </div>
            </div>
          </div>
          <div className="field">
            <label>实时克单价（元/克）· 今日售价</label>
            <input
              className="input"
              type="number"
              min={0}
              value={sharePrice}
              onChange={(e) => setSharePrice(e.target.value)}
              placeholder="如 588"
            />
            <div className="muted" style={{ marginTop: 6 }}>
              已默认填入入库克单价（{shareTarget.gram_price || 0} 元/克），可按今日行情修改；详情页将按此价格展示实时售价。
            </div>
          </div>
          <div className="row">
            <button className="btn btn-primary" onClick={() => void doShare()}>
              复制分享链接
            </button>
            <button className="btn" onClick={() => setShareTarget(null)}>
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

      {showOut && (
        <OutboundModal
          store={store}
          initialCode={outCode}
          onClose={() => {
            setShowOut(false)
            setOutCode(undefined)
          }}
          onDone={() => void load()}
        />
      )}

      {node}
    </>
  )
}
