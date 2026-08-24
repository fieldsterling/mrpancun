import COS from 'cos-js-sdk-v5'
import { supabase } from './supabase'
import type { Product, JournalEntry, DailySnapshot } from './types'

/** COS 备份内容 */
export interface CosBackupPayload {
  store: string
  businessDate: string
  products: Product[]
  journal: JournalEntry[]
  snapshots: DailySnapshot[]
}

/**
 * COS 快照备份
 * 备份路径：mrpancun/{店名}/{年}/{月}/{日期}/products.json、journal.jsonl、snapshot.json
 * （项目所有文档统一存放在 COS 的 mrpancun 文件夹下）
 *
 * 优先走 Edge Function `backup-cos` 代传（安全，不暴露永久密钥）；
 * 未部署时回退到前端直传（仅开发/自测，依赖 .env 中的 VITE_COS_SECRET_*）。
 */
export async function backupToCos(payload: CosBackupPayload): Promise<{ ok: boolean; via: string }> {
  // 1) Edge Function 代传
  if (supabase) {
    try {
      const { error } = await supabase.functions.invoke('backup-cos', { body: payload })
      if (!error) return { ok: true, via: 'edge-function' }
      // error 存在则继续尝试直传
    } catch {
      // 函数未部署等异常，继续尝试直传
    }
  }

  // 2) 前端直传（开发用）
  return directUpload(payload)
}

function directUpload(payload: CosBackupPayload): Promise<{ ok: boolean; via: string }> {
  const sid = import.meta.env.VITE_COS_SECRET_ID as string | undefined
  const skey = import.meta.env.VITE_COS_SECRET_KEY as string | undefined
  const bucket = import.meta.env.VITE_COS_BUCKET as string | undefined
  const region = import.meta.env.VITE_COS_REGION as string | undefined

  if (!sid || !skey || !bucket || !region) {
    throw new Error('COS 备份未配置：请先部署 backup-cos 函数，或在 .env 配置 VITE_COS_SECRET_*（仅开发用）')
  }

  const cos = new COS({ SecretId: sid, SecretKey: skey })

  const d = payload.businessDate.split('-') // YYYY-MM-DD
  const base = `mrpancun/${payload.store}/${d[0]}/${d[1]}/${payload.businessDate}`

  const files: Array<{ key: string; body: string }> = [
    { key: `${base}/products.json`, body: JSON.stringify(payload.products, null, 2) },
    {
      key: `${base}/journal.jsonl`,
      body: payload.journal.map((j) => JSON.stringify(j)).join('\n'),
    },
    { key: `${base}/snapshot.json`, body: JSON.stringify(payload.snapshots, null, 2) },
  ]

  return new Promise((resolve, reject) => {
    const uploads = files.map(
      (f) =>
        new Promise<void>((res, rej) => {
          cos.putObject(
            { Bucket: bucket, Region: region, Key: f.key, Body: f.body, ContentType: 'application/json' },
            (err) => (err ? rej(err) : res()),
          )
        }),
    )
    Promise.all(uploads)
      .then(() => resolve({ ok: true, via: 'direct' }))
      .catch((e) => reject(new Error(`COS 直传失败：${e?.message ?? e}`)))
  })
}
