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

/** 照片在 COS 中的相对路径（项目统一放在 mrpancun 文件夹下） */
export function photoKey(store: string, code: string): string {
  return `mrpancun/photos/${store}/${code}.jpg`
}

/** 把 COS key 转为可访问的 URL（路径各段做 URL 编码） */
export function cosUrl(key: string): string {
  const domain = import.meta.env.VITE_COS_DOMAIN
  if (!domain) return ''
  return `${domain}/${key.split('/').map(encodeURIComponent).join('/')}`
}

/**
 * 上传产品照片到 COS，返回可访问 URL。
 * 优先走 Edge Function `upload-photo` 代传（不暴露密钥）；
 * 未部署时回退到前端直传（仅开发/自测，依赖 .env 的 VITE_COS_SECRET_*）。
 */
export async function uploadProductPhoto(
  store: string,
  code: string,
  dataUrl: string,
): Promise<string> {
  if (supabase) {
    try {
      const { data, error } = await supabase.functions.invoke('upload-photo', {
        body: { store, code, dataUrl },
      })
      if (!error && data?.url) return data.url as string
    } catch {
      // 函数未部署等异常，继续尝试直传
    }
  }
  return directUploadPhoto(store, code, dataUrl)
}

function directUploadPhoto(store: string, code: string, dataUrl: string): Promise<string> {
  const sid = import.meta.env.VITE_COS_SECRET_ID as string | undefined
  const skey = import.meta.env.VITE_COS_SECRET_KEY as string | undefined
  const bucket = import.meta.env.VITE_COS_BUCKET as string | undefined
  const region = import.meta.env.VITE_COS_REGION as string | undefined
  if (!sid || !skey || !bucket || !region) {
    throw new Error('照片上传未配置：请先部署 upload-photo 函数，或在 .env 配置 VITE_COS_SECRET_*（仅开发用）')
  }

  const cos = new COS({ SecretId: sid, SecretKey: skey })
  const key = photoKey(store, code)
  const blob = dataUrlToBlob(dataUrl)

  return new Promise((resolve, reject) => {
    cos.putObject(
      { Bucket: bucket, Region: region, Key: key, Body: blob, ContentType: 'image/jpeg' },
      (err) => (err ? reject(new Error(`照片直传失败：${err.message ?? err}`)) : resolve(cosUrl(key))),
    )
  })
}

/** dataURL（data:image/jpeg;base64,...）→ Blob */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, base64] = dataUrl.split(',')
  const mime = /data:([^;]+);/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type: mime })
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
  // 照片仅本地存储，备份时剔除（base64 体积大，且容易撑爆 Edge Function 请求体）；
  // photo_url（云端地址）与 deleted_at（软删除标记）正常写入备份，便于追溯与恢复
  const products = payload.products.map(({ photo: _photo, photo_thumb: _thumb, ...rest }) => rest)
  const clean = { ...payload, products }

  // 1) Edge Function 代传
  if (supabase) {
    try {
      const { error } = await supabase.functions.invoke('backup-cos', { body: clean })
      if (!error) return { ok: true, via: 'edge-function' }
      // error 存在则继续尝试直传
    } catch {
      // 函数未部署等异常，继续尝试直传
    }
  }

  // 2) 前端直传（开发用）
  return directUpload(clean)
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
