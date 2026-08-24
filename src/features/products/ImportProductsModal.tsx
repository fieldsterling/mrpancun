import { useState } from 'react'
import * as XLSX from 'xlsx'
import { bulkUpsertProducts } from '@/lib/localDb'
import type { Product } from '@/lib/types'
import { Modal, useToast } from '@/components/ui'

interface Props {
  store: string
  onClose: () => void
  onImported: (count: number) => void
}

type Raw = Record<string, unknown>

/** 列名别名映射（中英文均支持，大小写不敏感） */
const FIELD_ALIASES: Record<keyof Omit<Product, 'updated_at'>, string[]> = {
  code: ['产品编号', '编号', 'code', '商品编号', 'productcode'],
  name: ['名称', '品名', 'name', '商品名称'],
  category: ['类别', '分类', 'category'],
  material: ['材质', '材料', 'material'],
  qty: ['数量', '库存', 'qty', 'quantity', '库存数量'],
  gram_weight: ['克重', '重量', '克重(g)', 'gram_weight', 'weight'],
  gram_price: ['克单价', '克价', '单价', 'gram_price', 'price'],
  total_price: ['总价', 'total_price'],
  barcode: ['条码', '条形码', 'barcode'],
  store: ['店名', '门店', 'store'],
}

/** 按别名查找字段值（首列命中优先） */
function field(r: Raw, key: keyof Omit<Product, 'updated_at'>): unknown {
  for (const alias of FIELD_ALIASES[key]) {
    const lower = alias.toLowerCase()
    for (const [k, v] of Object.entries(r)) {
      if (v != null && String(k).trim().toLowerCase() === lower) return v
    }
  }
  return undefined
}

/** 数值解析：容忍千分位与空值 */
function toNum(v: unknown): number {
  if (v == null) return 0
  const s = String(v).replace(/,/g, '').trim()
  if (!s) return 0
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** 将表行对象解析为产品记录 */
function parseRows(rows: Raw[], defaultStore: string): Product[] {
  const out: Product[] = []
  const now = new Date().toISOString()
  for (const r of rows) {
    const code = String(field(r, 'code') ?? '').trim()
    if (!code) continue
    const gramWeight = toNum(field(r, 'gram_weight'))
    const gramPrice = toNum(field(r, 'gram_price'))
    const qty = toNum(field(r, 'qty'))
    const calcTotal = Math.round(gramWeight * gramPrice * qty * 100) / 100
    const total = toNum(field(r, 'total_price')) || calcTotal
    const store = String(field(r, 'store') ?? '').trim() || defaultStore
    out.push({
      code,
      store,
      category: String(field(r, 'category') ?? '').trim(),
      name: String(field(r, 'name') ?? '').trim(),
      material: String(field(r, 'material') ?? '').trim(),
      qty,
      gram_weight: gramWeight,
      gram_price: gramPrice,
      total_price: total,
      barcode: String(field(r, 'barcode') ?? '').trim(),
      updated_at: now,
    })
  }
  return out
}

/** 简单 CSV 解析：处理双引号包裹的字段 */
function splitLine(line: string, sep: string): string[] {
  const out: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else inQ = false
      } else cur += ch
    } else if (ch === '"') {
      inQ = true
    } else if (line.startsWith(sep, i)) {
      out.push(cur.trim())
      cur = ''
      i += sep.length - 1
    } else {
      cur += ch
    }
  }
  out.push(cur.trim())
  return out
}

function detectSep(line: string): string {
  return line.includes('\t') ? '\t' : ','
}

/** 解析 TXT / CSV：有表头则按表头映射；无表头按固定列顺序 编号,名称,类别,材质,数量,克重,克单价,总价,条码,店名 */
function parseText(text: string, defaultStore: string): Product[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (lines.length === 0) return []
  const sep = detectSep(lines[0])
  const isHeader =
    /(编号|产品编号|code|名称|品名|name|条码|barcode|克重|重量|材质|material)/i.test(lines[0]) &&
    lines[0].includes(sep)

  const rows: Raw[] = []
  if (isHeader) {
    const headers = splitLine(lines[0], sep)
    for (const line of lines.slice(1)) {
      const cells = splitLine(line, sep)
      const obj: Raw = {}
      headers.forEach((h, i) => {
        obj[h.trim()] = cells[i]
      })
      rows.push(obj)
    }
  } else {
    for (const line of lines) {
      const c = splitLine(line, sep)
      rows.push({
        编号: c[0], 名称: c[1], 类别: c[2], 材质: c[3], 数量: c[4],
        克重: c[5], 克单价: c[6], 总价: c[7], 条码: c[8], 店名: c[9],
      })
    }
  }
  return parseRows(rows, defaultStore)
}

const PREVIEW_LIMIT = 8

export default function ImportProductsModal({ store, onClose, onImported }: Props) {
  const { show, node } = useToast()
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<Product[] | null>(null)
  const [importing, setImporting] = useState(false)

  const onFile = async (f: File | undefined) => {
    if (!f) return
    const name = f.name.toLowerCase()
    try {
      let parsed: Product[] = []
      if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
        const wb = XLSX.read(await f.arrayBuffer())
        const ws = wb.Sheets[wb.SheetNames[0]]
        const raw = XLSX.utils.sheet_to_json<Raw>(ws, { defval: '' })
        parsed = parseRows(raw, store)
      } else if (name.endsWith('.txt') || name.endsWith('.csv')) {
        parsed = parseText(await f.text(), store)
      } else {
        show('不支持的文件类型，仅支持 TXT / CSV / Excel', 'err')
        return
      }
      setFileName(f.name)
      setRows(parsed)
      if (parsed.length === 0) show('未解析到有效产品（需包含「编号」列）', 'err')
    } catch (e) {
      setRows(null)
      show(`导入失败：${(e as Error).message}`, 'err')
    }
  }

  const doImport = async () => {
    if (!rows || rows.length === 0) return
    setImporting(true)
    try {
      await bulkUpsertProducts(rows)
      show(`已导入 ${rows.length} 条产品`, 'ok')
      onImported(rows.length)
      onClose()
    } catch (e) {
      show(`写入失败：${(e as Error).message}`, 'err')
      setImporting(false)
    }
  }

  const preview = rows?.slice(0, PREVIEW_LIMIT) ?? []

  return (
    <Modal title="导入产品信息表" onClose={onClose}>
      <div className="muted mb">
        支持 <b>Excel（.xlsx / .xls）</b> 与 <b>TXT / CSV</b>。列名支持：编号、名称、类别、材质、数量、克重、
        克单价、总价、条码、店名（缺省用当前门店）。未填总价时自动按「克重 × 克单价 × 数量」计算。
      </div>

      <label className="btn btn-primary mb">
        选择文件
        <input
          type="file"
          accept=".txt,.csv,.xlsx,.xls"
          style={{ display: 'none' }}
          onChange={(e) => {
            void onFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
      </label>

      {fileName && <div className="muted mb">已选择：{fileName}</div>}

      {rows !== null && (
        <>
          <div className="mb">
            解析到 <b>{rows.length}</b> 条产品，预览前 {Math.min(PREVIEW_LIMIT, rows.length)} 条：
          </div>
          <div className="table-wrap mb">
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
                  <th>店名</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((p, i) => (
                  <tr key={i}>
                    <td>{p.code}</td>
                    <td>{p.name || <span className="muted">—</span>}</td>
                    <td>{p.category || <span className="muted">—</span>}</td>
                    <td>{p.material || <span className="muted">—</span>}</td>
                    <td className="t-num">{p.qty}</td>
                    <td className="t-num">{p.gram_weight}</td>
                    <td className="t-num">{p.gram_price}</td>
                    <td>{p.store}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row">
            <button className="btn btn-primary" disabled={rows.length === 0 || importing} onClick={() => void doImport()}>
              {importing ? '导入中…' : `确认导入 ${rows.length} 条`}
            </button>
            <button className="btn" onClick={onClose}>
              取消
            </button>
          </div>
        </>
      )}

      {node}
    </Modal>
  )
}
