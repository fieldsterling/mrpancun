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
