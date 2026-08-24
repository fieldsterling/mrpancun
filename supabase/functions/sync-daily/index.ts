// 日终同步函数：把客户端本地三表数据批量 upsert 到 Supabase
//
// 部署（在 supabase/ 目录）：
//   supabase functions deploy sync-daily --no-verify-jwt
// 需要环境变量：
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   （Service Role Key 在控制台 Settings -> API 获取）

import { createClient } from 'npm:@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ ok: false, error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    const { products, journal, snapshots } = await req.json()

    if (Array.isArray(products) && products.length > 0) {
      const { error } = await supabase
        .from('mrpancun_products')
        .upsert(products, { onConflict: 'code,store' })
      if (error) throw error
    }

    if (Array.isArray(journal) && journal.length > 0) {
      // source_id 唯一，防止重复同步
      const { error } = await supabase
        .from('mrpancun_inventory_journal')
        .upsert(journal, { onConflict: 'source_id' })
      if (error) throw error
    }

    if (Array.isArray(snapshots) && snapshots.length > 0) {
      const { error } = await supabase
        .from('mrpancun_daily_inventory_snapshot')
        .upsert(snapshots, { onConflict: 'business_date,product_code,store' })
      if (error) throw error
    }

    return new Response(
      JSON.stringify({
        ok: true,
        products: products?.length ?? 0,
        journal: journal?.length ?? 0,
        snapshots: snapshots?.length ?? 0,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: (e as Error).message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    )
  }
})
