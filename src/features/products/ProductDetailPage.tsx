import { useEffect, useMemo, useState } from 'react'
import { getProduct } from '@/lib/localDb'
import { supabase } from '@/lib/supabase'
import type { Product } from '@/lib/types'
import { unitPrice } from '@/lib/reconcile'
import { copyText } from '@/lib/clipboard'
import { formatCN } from '@/lib/date'
import { generatePoster } from '@/lib/poster'
import { Modal, useToast } from '@/components/ui'

interface Props {
  store: string
  code: string
  /** 分享链接携带的实时克单价（今日售价，元/克），未传则回退到入库克单价 */
  price?: number
  onClose: () => void
}

const fmtN = (n: number | undefined, digits = 2) => {
  const v = Number(n ?? 0)
  if (v === 0) return '0'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

/**
 * 产品详情分享页
 * 通过分享链接 `?store=xxx&code=yyy` 直达；本机有数据直接展示（含照片），
 * 本机没有则尝试从 Supabase 拉取（跨设备分享时照片不包含，其余字段完整）。
 */
export default function ProductDetailPage({ store, code, price, onClose }: Props) {
  const { show, node } = useToast()
  const [p, setP] = useState<Product | null | undefined>(undefined) // undefined = 加载中
  const [cloud, setCloud] = useState(false)
  // 海报
  const [poster, setPoster] = useState<string | null>(null)
  const [posterBusy, setPosterBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const found = await getProduct(code, store)
      if (!alive) return
      if (found) {
        setP(found)
        setCloud(false)
        return
      }
      if (supabase) {
        const { data } = await supabase
          .from('mrpancun_products')
          .select('*')
          .eq('code', code)
          .eq('store', store)
          .maybeSingle()
        if (!alive) return
        if (data) {
          setP(data as Product)
          setCloud(true)
          return
        }
      }
      setP(null)
      setCloud(false)
    })()
    return () => {
      alive = false
    }
  }, [code, store])

  // 实时克单价：分享链接带 gp 参数时用它展示今日售价，否则回退到入库克单价
  const hasLive = !!(price && price > 0)
  const liveUnit = p
    ? (p.gram_weight || 0) * ((hasLive ? price : p.gram_price || 0) + (p.gram_fee || 0)) + (p.piece_fee || 0)
    : 0
  const unit = hasLive ? liveUnit : p ? unitPrice(p) : 0
  const total = hasLive ? liveUnit * (p?.qty ?? 0) : p ? p.total_price || unit * p.qty : 0

  const shareLink = useMemo(() => {
    const u = new URL(window.location.href)
    u.searchParams.set('store', store)
    u.searchParams.set('code', code)
    return u.toString()
  }, [store, code])

  const onCopy = async () => {
    const ok = await copyText(shareLink)
    show(ok ? '产品链接已复制' : '复制失败，请手动复制浏览器地址栏链接', ok ? 'ok' : 'err')
  }

  const onPoster = async () => {
    if (!p) return
    setPosterBusy(true)
    try {
      const dataUrl = await generatePoster({
        product: p,
        link: shareLink,
        price: hasLive ? price : undefined,
        unit,
        total,
      })
      setPoster(dataUrl)
    } catch (e) {
      show(`海报生成失败：${(e as Error).message}`, 'err')
    } finally {
      setPosterBusy(false)
    }
  }

  return (
    <div className="detail-page">
      <header className="detail-top">
        <button className="btn btn-sm" onClick={onClose}>
          ← 返回
        </button>
        <div className="brand">
          <span className="brand-mark">金</span>
          <span>金店每日盘存</span>
        </div>
        <button className="btn btn-sm" onClick={() => void onCopy()}>
          复制链接
        </button>
        <button className="btn btn-sm btn-primary" disabled={posterBusy || !p} onClick={() => void onPoster()}>
          {posterBusy ? '生成中…' : '生成海报'}
        </button>
      </header>

      <main className="detail-main">
        {p === undefined ? (
          <div className="detail-card detail-loading">
            <div className="skeleton" style={{ height: 280, borderRadius: 0 }} />
            <div className="detail-body">
              <div className="skeleton sk-row" style={{ width: '55%' }} />
              <div className="skeleton sk-row" style={{ width: '35%' }} />
              <div className="skeleton sk-row" style={{ width: '85%' }} />
              <div className="skeleton sk-row" style={{ width: '70%' }} />
            </div>
          </div>
        ) : p === null ? (
          <div className="detail-card detail-empty">
            <div className="detail-empty-icon">◆</div>
            <h3>未找到该产品</h3>
            <p className="muted">
              编号 {code} · {store}
              {cloud ? ' · 云端无此记录' : ' · 本机与云端均无此记录'}
            </p>
            <button className="btn" onClick={onClose}>
              返回产品管理
            </button>
          </div>
        ) : (
          <article className="detail-card">
            <div className="detail-photo">
              {p.photo ? (
                <img src={p.photo} alt={p.name || p.code} />
              ) : (
                <div className="detail-photo-empty">
                  <span className="detail-photo-gem">◆</span>
                  <span className="muted">暂无照片</span>
                </div>
              )}
            </div>
            <div className="detail-body">
              <h1 className="detail-name">{p.name || '未命名产品'}</h1>
              <div className="detail-code">编号 {p.code}</div>

              <div className="detail-tags">
                {p.category && <span className="tag">{p.category}</span>}
                {p.material && <span className="tag">{p.material}</span>}
                {p.qty > 0 ? (
                  <span className="badge badge-ok">在库 {p.qty} 件</span>
                ) : (
                  <span className="badge badge-warn">暂无库存</span>
                )}
                {hasLive && <span className="badge badge-gold">今日实时价</span>}
              </div>

              <div className="detail-price">
                <div className="detail-price-lbl">{hasLive ? '今日参考总价' : '参考总价'}</div>
                <div className="detail-price-num">￥{fmtN(total)}</div>
                <div className="detail-price-sub">单件约 ￥{fmtN(unit)}</div>
              </div>

              <div className="detail-grid">
                <div className="detail-cell">
                  <span>克重</span>
                  <b>{fmtN(p.gram_weight, 3)} g</b>
                </div>
                <div className="detail-cell">
                  <span>{hasLive ? '实时克单价' : '克单价'}</span>
                  <b>￥{fmtN(hasLive ? price : p.gram_price)}</b>
                </div>
                <div className="detail-cell">
                  <span>克工费</span>
                  <b>￥{fmtN(p.gram_fee)}</b>
                </div>
                <div className="detail-cell">
                  <span>件工费</span>
                  <b>￥{fmtN(p.piece_fee)}</b>
                </div>
              </div>

              <dl className="detail-info">
                <div>
                  <dt>门店</dt>
                  <dd>{p.store}</dd>
                </div>
                {hasLive && (
                  <div>
                    <dt>入库克单价</dt>
                    <dd>￥{fmtN(p.gram_price)}</dd>
                  </div>
                )}
                <div>
                  <dt>条码</dt>
                  <dd>{p.barcode || '—'}</dd>
                </div>
                <div>
                  <dt>入库时间</dt>
                  <dd>{formatCN(p.created_at || p.updated_at)}</dd>
                </div>
                <div>
                  <dt>最后更新</dt>
                  <dd>{formatCN(p.updated_at)}</dd>
                </div>
              </dl>
            </div>
          </article>
        )}
      </main>

      <footer className="detail-foot">
        <span>数据来源：金店每日盘存</span>
        {cloud && <span className="badge badge-gold">云端数据</span>}
      </footer>

      {poster && (
        <Modal title="产品海报" onClose={() => setPoster(null)}>
          <img src={poster} alt="产品海报" className="poster-img" />
          <div className="muted" style={{ margin: '10px 0 14px' }}>
            手机端长按图片可保存；也可点击下方按钮下载到本地。
          </div>
          <div className="row">
            <a
              className="btn btn-primary"
              href={poster}
              download={`${p?.code || 'product'}-poster.png`}
            >
              下载海报
            </a>
            <button className="btn" onClick={() => setPoster(null)}>
              关闭
            </button>
          </div>
        </Modal>
      )}

      {node}
    </div>
  )
}
