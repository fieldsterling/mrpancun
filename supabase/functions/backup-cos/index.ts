// COS 快照备份函数：服务端代传，避免在前端暴露 COS 永久密钥
//
// 备份路径（项目所有文档统一存放在 COS 的 mrpancun 文件夹下）：
//   mrpancun/{店名}/{年}/{月}/{日期}/products.json、journal.jsonl、snapshot.json
//
// 部署（在 supabase/ 目录）：
//   supabase functions deploy backup-cos --no-verify-jwt
// 需要环境变量：
//   COS_SECRET_ID, COS_SECRET_KEY, COS_BUCKET, COS_REGION
//   （在 Supabase 控制台 Edge Functions 的 Secrets 中配置，密钥不会暴露到前端）
//
// 实现：使用 COS V5 签名算法（HMAC-SHA1） + 标准 fetch PUT，无需第三方依赖。

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

/** PUT 一个对象到 COS（V5 签名） */
async function putObject(opts: {
  secretId: string
  secretKey: string
  host: string
  key: string
  body: string
}): Promise<void> {
  const { secretId, secretKey, host, key, body } = opts
  const contentType = 'application/json'
  const start = Math.floor(Date.now() / 1000)
  const end = start + 600
  const keyTime = `${start};${end}`

  const signKey = await hmacSha1Hex(secretKey, keyTime)
  const uri = cosEncodePath(key)
  const httpHeaders = `content-type=${contentType}&host=${host}`
  const httpString = `put\n${uri}\n\n${httpHeaders}\n`
  const stringToSign = `sha1\n${keyTime}\n${await sha1Hex(httpString)}\n`
  const signature = await hmacSha1Hex(signKey, stringToSign)

  const authorization =
    `q-sign-algorithm=sha1&q-ak=${secretId}` +
    `&q-sign-time=${keyTime}&q-key-time=${keyTime}` +
    `&q-header-list=content-type;host&q-url-param-list=` +
    `&q-signature=${signature}`

  const resp = await fetch(`https://${host}${uri}`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType, Authorization: authorization },
    body,
  })
  if (!resp.ok) {
    throw new Error(`COS PUT ${key} 失败：HTTP ${resp.status} ${(await resp.text()).slice(0, 300)}`)
  }
}

/** 组装本次备份的 JSON / JSONL 文件 */
function buildFiles(payload: {
  store: string
  businessDate: string
  products: unknown[]
  journal: unknown[]
  snapshots: unknown[]
}): Array<{ key: string; body: string }> {
  const d = payload.businessDate.split('-') // YYYY-MM-DD
  const base = `mrpancun/${payload.store}/${d[0]}/${d[1]}/${payload.businessDate}`
  return [
    { key: `${base}/products.json`, body: JSON.stringify(payload.products, null, 2) },
    {
      key: `${base}/journal.jsonl`,
      body: payload.journal.map((j) => JSON.stringify(j)).join('\n'),
    },
    { key: `${base}/snapshot.json`, body: JSON.stringify(payload.snapshots, null, 2) },
  ]
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const payload = await req.json()
    if (!payload?.businessDate || !payload?.store) {
      throw new Error('缺少 store / businessDate')
    }

    const secretId = Deno.env.get('COS_SECRET_ID')
    const secretKey = Deno.env.get('COS_SECRET_KEY')
    const bucket = Deno.env.get('COS_BUCKET')
    const region = Deno.env.get('COS_REGION')
    if (!secretId || !secretKey || !bucket || !region) {
      throw new Error('未配置 COS_SECRET_ID / COS_SECRET_KEY / COS_BUCKET / COS_REGION')
    }

    const host = `${bucket}.cos.${region}.myqcloud.com`
    const files = buildFiles({
      store: payload.store,
      businessDate: payload.businessDate,
      products: payload.products ?? [],
      journal: payload.journal ?? [],
      snapshots: payload.snapshots ?? [],
    })

    for (const f of files) {
      await putObject({ secretId, secretKey, host, key: f.key, body: f.body })
    }

    return new Response(
      JSON.stringify({ ok: true, files: files.map((f) => f.key) }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
