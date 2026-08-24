/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  readonly VITE_COS_BUCKET?: string
  readonly VITE_COS_REGION?: string
  readonly VITE_COS_DOMAIN?: string
  readonly VITE_COS_SECRET_ID?: string
  readonly VITE_COS_SECRET_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
