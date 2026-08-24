// 时区工具：业务日期统一按中国时区(GMT+8)计算
// Supabase 的 timestamptz 默认存 UTC，前端展示统一转中国时区

const CN_TZ = 'Asia/Shanghai'

/** 今天（中国时区），格式 YYYY-MM-DD */
export function todayCN(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

/** ISO 时间 → 中国时区 YYYY-MM-DD（用于按天汇总） */
export function cnDateOf(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** 在 YYYY-MM-DD 日期字符串上加减天数，返回 YYYY-MM-DD（纯日期运算，与时区无关） */
export function addDaysCN(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  if (!y || !m || !d) return dateStr
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

/** 在 YYYY-MM 月份字符串上加减月数，返回 YYYY-MM */
export function addMonthsCN(monthStr: string, months: number): string {
  const [y, m] = monthStr.split('-').map(Number)
  if (!y || !m) return monthStr
  const dt = new Date(Date.UTC(y, m - 1 + months, 1))
  return dt.toISOString().slice(0, 7)
}

/** 取 YYYY-MM-DD 的月份部分 YYYY-MM */
export function monthOf(dateStr: string): string {
  return dateStr.slice(0, 7)
}

/** 把 ISO 时间转为中国时区可读字符串，如 2026-08-25 09:00 */
export function formatCN(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '-'
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
}

/** 判断 ISO 时间是否属于中国时区的某一天 */
export function isSameCNDate(iso: string, dateStr: string): boolean {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return false
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: CN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  return ymd === dateStr
}
