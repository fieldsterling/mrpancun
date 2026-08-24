// 产品照片上传函数：把客户端传来的 base64 照片写入 COS（服务端代传，避免在前端暴露 COS 永久密钥）
//
// 上传路径：mrpancun/photos/{店名}/{产品编号}.jpg
// （项目所有文档统一存放在 COS 的 mrpancun 文件夹下）
//
// 部署（在 supabase/ 目录）：
//   supabase functions deploy upload-photo --no-verify-jwt
// 需要环境变量：
//   COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
//
// 实现：与 backup-cos 相同，使用 COS V5 签名算法（HMAC-SHA1）+ 标准 fetch PUT。

const enc = new TextEncoder()

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** HMAC-SHA1，返回 hex */
async function hmacSha1Hex(key: string, msg: string): Promise<string> {
  const keyBuf = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', keyBuf, enc.encode(msg))
  return hex(sig)
}

/** SHA1，返回 hex */
async function sha1Hex(msg: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-1', enc.encode(msg)))
}

/** 对 COS 路径做签名规范要求的 URL 编码（保留 / 与字母数字、-_.~） */
function cosEncodePath(p: string): string {
  return encodeURIComponent(p).replace(/%2F/gi, '/')
}

/** PUT 一个二进制对象到 COS（V5 签名） */
async function putObject(opts: {
  secretId: string
  secretKey: string
  host: string
  key: string
  body: Uint8Array
  contentType: string
}): Promise<void> {
  const { secretId, secretKey, host, key, body, contentType } = opts
  const start = Math.floor(Date.now() / 1000)
  const end = start + 600
  const keyTime = `${start};${end}`

  const signKey = await hmacSha1Hex(secretKey, keyTime)
  const rawUri = '/' + key // 签名用：原始未编码路径
  const encUri = '/' + cosEncodePath(key) // 请求用：URL 编码路径
  // HttpHeaders 中的值必须做 URL 编码（如 image/jpeg -> image%2Fjpeg），
  // 否则服务端重建的签名串不一致，报 SignatureDoesNotMatch
  const httpHeaders = `content-type=${encodeURIComponent(contentType)}&host=${encodeURIComponent(host)}`
  const httpString = `put\n${rawUri}\n\n${httpHeaders}\n`
  const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(httpString)}\n`
  const signature = await hmacSha1Hex(signKey, stringToSign)

  const authorization =
    `q-sign-algorithm=sha1&q-ak=${secretId}` +
    `&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=content-type;host&q-url-param-list=` +
    `&q-signature=${signature}`

  const resp = await fetch(`https://${host}${encUri}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, Authorization: authorization },
    body,
  })
  if (!resp.ok) {
    throw new Error(`COS PUT ${key} 失败：HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
}

/** dataURL（data:image/jpeg;base64,...）→ 字节 + mime */
function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } {
  const comma = dataUrl.indexOf(',')
  const head = comma >= 0 ? dataUrl.slice(0, comma) : ''
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const mime = /data:([^;]+);/.exec(head)?.[1] ?? 'image/jpeg'
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return { bytes, mime }
}

// 浏览器直调需要 CORS：Supabase 不会自动给函数响应加跨域头，必须自己处理 OPTIONS 预检
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  }

  try {
    const { store, code, dataUrl } = await req.json()
    if (typeof store !== 'string' || typeof code !== 'string' || typeof dataUrl !== 'string') {
      throw new Error('缺少 store / code / dataUrl')
    }

    const secretId = Deno.env.get('COS_SECRET_ID')
    const secretKey = Deno.env.get('COS_SECRET_KEY')
    const bucket = Deno.env.get('COS_BUCKET')
    const region = Deno.env.get('COS_REGION')
    if (!secretId || !secretKey || !bucket || !region) {
      throw new Error('未配置 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION')
    }

    const key = `mrpancun/photos/${store}/${code}.jpg`
    const host = `${bucket}.cos.${region}.myqcloud.com`
    const { bytes, mime } = dataUrlToBytes(dataUrl)
    const contentType = mime.startsWith('image/') ? mime : 'image/jpeg'

    await putObject({ secretId, secretKey, host, key, body: bytes, contentType })

    return new Response(
      JSON.stringify({ ok: true, url: `https://${host}/${cosEncodePath(key)}` }),
      { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
    )
  }
})
