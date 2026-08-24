import { useEffect, useMemo, useState } from 'react'
import { listProducts, stockOut } from '@/lib/localDb'
import type { Product } from '@/lib/types'
import { Modal, useToast } from '@/components/ui'

interface Props {
  store: string
  /** 预选产品编号（从产品管理页每行「出库」进入时传入） */
  initialCode?: string
  onClose: () => void
  onDone: () => void
}

/** 手动出库：选择产品 + 填写数量/原因/客户，写入 OUT 流水并扣减库存 */
export default function OutboundModal({ store, initialCode, onClose, onDone }: Props) {
  const { show, node } = useToast()
  const [products, setProducts] = useState<Product[] | null>(null)
  const [code, setCode] = useState(initialCode ?? '')
  const [qty, setQty] = useState<number>(1)
  const [outPrice, setOutPrice] = useState<number>(0)
  const [settlePrice, setSettlePrice] = useState<number>(0)
  const [settleTouched, setSettleTouched] = useState(false)
  const [reason, setReason] = useState('')
  const [customer, setCustomer] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    void (async () => {
      const list = await listProducts(store)
      const withStock = list.filter((p) => p.qty > 0)
      setProducts(withStock)
      // 预选产品：直接带入单价/数量
      if (initialCode && withStock.some((p) => p.code === initialCode)) {
        selectProduct(initialCode)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store, initialCode])

  const product = useMemo(() => products?.find((p) => p.code === code), [products, code])

  /** 结算价 = 克重 × 克单价 × 数量 */
  const calcSettle = (price: number, n: number) =>
    Math.round(((product?.gram_weight || 0) * price * n) * 100) / 100

  const selectProduct = (c: string) => {
    setCode(c)
    const p = products?.find((x) => x.code === c)
    setQty(1)
    setOutPrice(p?.gram_price || 0)
    setSettlePrice(calcSettle(p?.gram_price || 0, 1))
    setSettleTouched(false)
  }

  const changeOutPrice = (v: number) => {
    setOutPrice(v)
    if (!settleTouched) setSettlePrice(calcSettle(v, qty))
  }

  const changeQty = (v: number) => {
    setQty(v)
    if (!settleTouched) setSettlePrice(calcSettle(outPrice, v))
  }

  const doOut = async () => {
    if (!product) {
      show('请选择要出库的产品', 'err')
      return
    }
    const n = Math.round(qty * 1000) / 1000
    if (!(n > 0)) {
      show('请输入有效的出库数量', 'err')
      return
    }
    if (n > product.qty) {
      show(`库存不足：${product.code} 当前仅 ${product.qty} 件`, 'err')
      return
    }
    setSaving(true)
    try {
      await stockOut(
        {
          source_id: crypto.randomUUID(),
          ts: new Date().toISOString(),
          product_code: product.code,
          store,
          direction: 'OUT',
          qty: n,
          note: reason.trim() ? `出库：${reason.trim()}` : '出库',
          unit_price: outPrice || 0,
          settle_price: settlePrice || 0,
          customer: customer.trim() || undefined,
        },
        product,
      )
      show('已出库并扣减库存', 'ok')
      onDone()
      onClose()
    } catch (e) {
      show(`出库失败：${(e as Error).message}`, 'err')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="产品出库" onClose={onClose}>
      <div className="muted mb">
        记录一次手动出库（如销售、调拨、破损），将写入出库流水并扣减对应库存。
      </div>

      <div className="field">
        <label>选择产品</label>
        <select className="select" value={code} onChange={(e) => selectProduct(e.target.value)}>
          <option value="">请选择（当前有库存的产品）</option>
          {products?.map((p) => (
            <option key={p.code} value={p.code}>
              {p.code} · {p.name || '未命名'}（库存 {p.qty}）
            </option>
          ))}
        </select>
      </div>

      {product && (
        <div className="muted mb">
          当前库存：<b>{product.qty}</b> 件；克重 {product.gram_weight || '—'} g
        </div>
      )}

      <div className="field">
        <label>出库克单价（元/克）</label>
        <input
          className="input"
          type="number"
          min={0}
          step={0.01}
          placeholder="出货时的克单价，将记录到出库流水"
          value={outPrice}
          onChange={(e) => changeOutPrice(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>出库数量</label>
        <input
          className="input"
          type="number"
          min={0}
          value={qty}
          onChange={(e) => changeQty(Number(e.target.value))}
        />
      </div>

      <div className="field">
        <label>结算价（元）</label>
        <input
          className="input"
          type="number"
          min={0}
          step={0.01}
          placeholder="默认 = 克重 × 克单价 × 数量，可按实际成交价修改"
          value={settlePrice}
          onChange={(e) => {
            setSettlePrice(Number(e.target.value))
            setSettleTouched(true)
          }}
        />
      </div>

      <div className="field">
        <label>原因（可选）</label>
        <input
          className="input"
          placeholder="如：销售、调拨、破损…"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      <div className="field">
        <label>客户（可选）</label>
        <input
          className="input"
          placeholder="如：王先生、某某金行…"
          value={customer}
          onChange={(e) => setCustomer(e.target.value)}
        />
      </div>

      <div className="row">
        <button className="btn btn-danger" disabled={saving} onClick={() => void doOut()}>
          {saving ? '出库中…' : '确认出库'}
        </button>
        <button className="btn" onClick={onClose}>
          取消
        </button>
      </div>

      {node}
    </Modal>
  )
}
