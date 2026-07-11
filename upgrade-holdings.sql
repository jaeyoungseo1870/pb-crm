-- ============================================================
-- 업그레이드: 랩 편입종목(holdings) 테이블 추가
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run
-- (기존 데이터는 건드리지 않습니다)
-- ============================================================

create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  base_date date not null,
  stock_name text not null,
  stock_code text,
  weight numeric,          -- 비중(%)
  value numeric,           -- 평가금액(백만원)
  rate numeric,            -- 수익률(%)
  memo text,
  created_at timestamptz default now()
);

alter table public.holdings enable row level security;

create policy "team all holdings"
on public.holdings for all to authenticated
using (true) with check (true);
