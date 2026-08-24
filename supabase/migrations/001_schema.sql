-- ============================================================
-- 金店每日盘存系统 - 001 基础表结构
-- 使用方式：在 Supabase 控制台 -> SQL Editor 执行本文件
-- 表名统一前缀 mrpancun_
-- ============================================================

-- 1. 产品信息表
-- 同一产品在不同门店建议用 (编号, 店名) 联合主键，避免多店库存互相覆盖
create table if not exists mrpancun_products (
  code        text not null,               -- 产品编号
  store       text not null,               -- 店名
  category    text,                        -- 类别
  name        text,                        -- 名称
  material    text,                        -- 材质
  qty         numeric(14,3) not null default 0 check (qty >= 0),
  gram_weight numeric(12,3),               -- 克重
  gram_price  numeric(12,2),               -- 克单价
  total_price numeric(16,2) generated always as (round(gram_weight * gram_price * qty, 2)) stored,
  barcode     text,                        -- 条码（可选，扫码枪可能需要）
  updated_at  timestamptz not null default now(),
  primary key (code, store)
);

-- 2. 进出库日记表
create table if not exists mrpancun_inventory_journal (
  id           bigint generated always as identity primary key,
  source_id    text not null unique,       -- 客户端生成，防止重复同步
  ts           timestamptz not null default now(),
  product_code text not null,
  store        text not null,
  direction    text not null check (direction in ('IN', 'OUT')),
  qty          numeric(14,3) not null check (qty > 0),
  note         text,
  foreign key (product_code, store) references mrpancun_products(code, store) on delete cascade
);

create index if not exists idx_journal_product_time on mrpancun_inventory_journal(product_code, store, ts desc);
create index if not exists idx_journal_store_time on mrpancun_inventory_journal(store, ts desc);

-- 3. 每日实际盘存结果表
-- 不建外键到产品表：实际盘存可能出现“数据库没有但实物有”的未知产品编号
create table if not exists mrpancun_daily_inventory_snapshot (
  business_date date not null,
  product_code  text not null,
  store         text not null,
  actual_qty    numeric(14,3) not null check (actual_qty >= 0),
  updated_at    timestamptz not null default now(),
  primary key (business_date, product_code, store)
);

-- ============================================================
-- RLS：内部工具系统，先放开读写（按需收紧）
-- 后续接入用户登录后可改为只允许 authenticated
-- ============================================================
alter table mrpancun_products enable row level security;
alter table mrpancun_inventory_journal enable row level security;
alter table mrpancun_daily_inventory_snapshot enable row level security;

drop policy if exists "allow all" on mrpancun_products;
create policy "allow all" on mrpancun_products
  for all using (true) with check (true);

drop policy if exists "allow all" on mrpancun_inventory_journal;
create policy "allow all" on mrpancun_inventory_journal
  for all using (true) with check (true);

drop policy if exists "allow all" on mrpancun_daily_inventory_snapshot;
create policy "allow all" on mrpancun_daily_inventory_snapshot
  for all using (true) with check (true);
