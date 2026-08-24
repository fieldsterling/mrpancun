// 产品分享海报生成（canvas 绘制，象牙白 + 金色主题）
// 使用 qrcode-generator 生成二维码（零依赖、本地离线可用）
import qrcode from 'qrcode-generator'
import type { Product } from './types'
import { formatCN } from './date'

const W = 750 // 海报宽
const M = 44 // 边距
const H = 1620 // 海报高（含底部留白）

const GOLD = '#b08d57'
const GOLD_DEEP = '#8f6f3c'
const GOLD_SOFT = '#efe4cf'
const TEXT = '#3d3529'
const MUTED = '#8b8272'

const FONT = "'PingFang SC','Microsoft YaHei',sans-serif"
const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`

const fmtN = (n: number | undefined, digits = 2): string => {
  const v = Number(n ?? 0)
  if (v === 0) return '0'
  return v.toLocaleString('zh-CN', { maximumFractionDigits: digits })
}

/** 加载图片；远程地址加 crossOrigin，CORS 失败则返回 null（海报回退占位图） */
function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    if (/^https?:\/\//i.test(src)) img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** 圆角矩形路径 */
function rr(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const p = Math.min(r, w / 2, h / 2)
  ctx.beginPath()
  ctx.moveTo(x + p, y)
  ctx.arcTo(x + w, y, x + w, y + h, p)
  ctx.arcTo(x + w, y + h, x, y + h, p)
  ctx.arcTo(x, y + h, x, y, p)
  ctx.arcTo(x, y, x + w, y, p)
  ctx.closePath()
}

/** 画二维码（白色圆角底 + 金色描边） */
function drawQR(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
): void {
  const qr = qrcode(0, 'M')
  qr.addData(text)
  qr.make()
  const n = qr.getModuleCount()
  const cell = size / n
  ctx.fillStyle = '#ffffff'
  rr(ctx, x - 12, y - 12, size + 24, size + 24, 16)
  ctx.fill()
  ctx.strokeStyle = 'rgba(176,141,87,0.45)'
  ctx.lineWidth = 2
  ctx.stroke()
  ctx.fillStyle = TEXT
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) ctx.fillRect(x + c * cell, y + r * cell, cell, cell)
    }
  }
}

export interface PosterOptions {
  product: Product
  link: string
  /** 实时克单价（今日售价，元/克）；未传则展示入库克单价 */
  price?: number
  /** 单件价（已按实时/入库克单价算好） */
  unit: number
  /** 总价（已按实时/入库克单价算好） */
  total: number
}

/** 生成海报，返回 PNG dataURL */
export async function generatePoster({
  product: p,
  link,
  price,
  unit,
  total,
}: PosterOptions): Promise<string> {
  const hasLive = !!(price && price > 0)

  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法创建画布')

  // 背景：象牙白渐变
  const bg = ctx.createLinearGradient(0, 0, 0, H)
  bg.addColorStop(0, '#fdf6e9')
  bg.addColorStop(1, '#f4efe7')
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, W, H)

  // 品牌头
  ctx.fillStyle = TEXT
  ctx.font = font(22, 700)
  const brandText = '金店每日盘存'
  const brandW = ctx.measureText(brandText).width
  const markS = 40
  const markX = Math.round((W - brandW - 12 - markS) / 2)
  const markG = ctx.createLinearGradient(0, 52, 0, 92)
  markG.addColorStop(0, '#d9b878')
  markG.addColorStop(1, GOLD_DEEP)
  ctx.fillStyle = markG
  rr(ctx, markX, 52, markS, markS, 11)
  ctx.fill()
  ctx.fillStyle = '#fff'
  ctx.font = font(20, 700)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('金', markX + markS / 2, 73)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = TEXT
  ctx.font = font(22, 700)
  ctx.fillText(brandText, markX + markS + 12, 82)

  let y = 52 + 40 + 34

  // 照片（4:3 裁剪）
  const photoW = W - M * 2
  const photoH = Math.round((photoW * 3) / 4)
  const photoX = M
  ctx.save()
  rr(ctx, photoX, y, photoW, photoH, 20)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  ctx.clip()
  const photo = await loadImage(p.photo || p.photo_url || '')
  if (photo) {
    const scale = Math.max(photoW / photo.width, photoH / photo.height)
    const dw = photo.width * scale
    const dh = photo.height * scale
    ctx.drawImage(photo, photoX + (photoW - dw) / 2, y + (photoH - dh) / 2, dw, dh)
  } else {
    ctx.fillStyle = GOLD_SOFT
    ctx.fillRect(photoX, y, photoW, photoH)
    ctx.fillStyle = GOLD
    ctx.font = font(72)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('◆', photoX + photoW / 2, y + photoH / 2 - 22)
    ctx.fillStyle = MUTED
    ctx.font = font(24)
    ctx.fillText('暂无照片', photoX + photoW / 2, y + photoH / 2 + 46)
  }
  ctx.restore()
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
  y += photoH + 26

  // 名称（超长省略）
  let name = p.name || '未命名产品'
  ctx.fillStyle = TEXT
  ctx.font = font(34, 700)
  if (ctx.measureText(name).width > W - M * 2) {
    while (name.length > 0 && ctx.measureText(name + '…').width > W - M * 2) {
      name = name.slice(0, -1)
    }
    name += '…'
  }
  ctx.fillText(name, M, y + 34)
  y += 46

  // 编号
  ctx.fillStyle = MUTED
  ctx.font = font(20)
  ctx.fillText(`编号 ${p.code}`, M, y)
  y += 30

  // 标签
  const tags: Array<{ text: string; gold?: boolean }> = []
  if (p.category) tags.push({ text: p.category })
  if (p.material) tags.push({ text: p.material })
  tags.push({ text: p.qty > 0 ? `在库 ${p.qty} 件` : '暂无库存' })
  if (hasLive) tags.push({ text: '今日实时价', gold: true })
  ctx.font = font(20, 600)
  let tx = M
  for (const t of tags) {
    const w = ctx.measureText(t.text).width + 26
    ctx.fillStyle = t.gold ? 'rgba(239,228,207,0.9)' : '#ffffff'
    rr(ctx, tx, y, w, 40, 20)
    ctx.fill()
    ctx.strokeStyle = 'rgba(176,141,87,0.35)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = t.gold ? GOLD_DEEP : TEXT
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(t.text, tx + w / 2, y + 21)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
    tx += w + 12
  }
  y += 56

  // 价格块
  ctx.save()
  rr(ctx, M, y, W - M * 2, 150, 20)
  const pg = ctx.createLinearGradient(0, y, 0, y + 150)
  pg.addColorStop(0, 'rgba(239,228,207,0.9)')
  pg.addColorStop(1, 'rgba(239,228,207,0.4)')
  ctx.fillStyle = pg
  ctx.fill()
  ctx.strokeStyle = 'rgba(176,141,87,0.4)'
  ctx.lineWidth = 1.5
  ctx.stroke()
  ctx.restore()
  ctx.textAlign = 'center'
  ctx.fillStyle = MUTED
  ctx.font = font(20)
  ctx.fillText(hasLive ? '今日参考总价' : '参考总价', W / 2, y + 36)
  ctx.fillStyle = GOLD_DEEP
  ctx.font = font(48, 800)
  ctx.fillText(`￥${fmtN(total)}`, W / 2, y + 96)
  ctx.fillStyle = MUTED
  ctx.font = font(20)
  ctx.fillText(`单件约 ￥${fmtN(unit)}`, W / 2, y + 132)
  ctx.textAlign = 'left'
  y += 150 + 26

  // 参数格（2×2）
  const grid: Array<[string, string]> = [
    ['克重', `${fmtN(p.gram_weight, 3)} g`],
    [hasLive ? '实时克单价' : '克单价', `￥${fmtN(hasLive ? price : p.gram_price)}`],
    ['克工费', `￥${fmtN(p.gram_fee)}`],
    ['件工费', `￥${fmtN(p.piece_fee)}`],
  ]
  const gap = 14
  const cellW = (W - M * 2 - gap) / 2
  const cellH = 92
  grid.forEach(([label, value], i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    const cx = M + col * (cellW + gap)
    const cy = y + row * (cellH + gap)
    ctx.fillStyle = '#ffffff'
    rr(ctx, cx, cy, cellW, cellH, 14)
    ctx.fill()
    ctx.strokeStyle = 'rgba(176,141,87,0.25)'
    ctx.lineWidth = 1.5
    ctx.stroke()
    ctx.fillStyle = MUTED
    ctx.font = font(19)
    ctx.fillText(label, cx + 18, cy + 32)
    ctx.fillStyle = TEXT
    ctx.font = font(28, 700)
    ctx.fillText(value, cx + 18, cy + 68)
  })
  y += cellH * 2 + gap + 26

  // 信息行
  const info: Array<[string, string]> = [
    ['门店', p.store],
    ...(hasLive ? ([['入库克单价', `￥${fmtN(p.gram_price)}`]] as Array<[string, string]>) : []),
    ['条码', p.barcode || '—'],
    ['入库时间', formatCN(p.created_at || p.updated_at)],
  ]
  for (const [k, v] of info) {
    ctx.fillStyle = MUTED
    ctx.font = font(20)
    ctx.fillText(k, M, y)
    ctx.fillStyle = TEXT
    ctx.textAlign = 'right'
    ctx.fillText(v, W - M, y)
    ctx.textAlign = 'left'
    ctx.strokeStyle = 'rgba(176,141,87,0.25)'
    ctx.setLineDash([4, 6])
    ctx.beginPath()
    ctx.moveTo(M, y - 20)
    ctx.lineTo(W - M, y - 20)
    ctx.stroke()
    ctx.setLineDash([])
    y += 40
  }
  y += 22

  // 二维码 + 说明
  const qrSize = 200
  const qrX = W - M - qrSize
  ctx.fillStyle = GOLD_DEEP
  ctx.font = font(26, 700)
  ctx.fillText('扫码查看产品详情', M, y + 34)
  ctx.fillStyle = MUTED
  ctx.font = font(18)
  ctx.fillText(`金店每日盘存 · ${p.store}`, M, y + 72)
  drawQR(ctx, link, qrX, y, qrSize)
  y += qrSize + 30

  // 底部
  ctx.fillStyle = MUTED
  ctx.font = font(18)
  ctx.textAlign = 'center'
  ctx.fillText('— 金店每日盘存 · 数据实时同步 —', W / 2, H - 34)

  return canvas.toDataURL('image/png')
}
