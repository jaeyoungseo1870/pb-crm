-- ============================================================
-- 업그레이드: 반도체 인텔리전스 (본인 전용) 테이블 추가
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run
-- (기존 데이터는 건드리지 않습니다)
-- 각 데이터는 등록한 본인만 보고 수정할 수 있습니다 (다른 팀원에게 보이지 않음)
-- ============================================================

-- 1) 관심종목
create table if not exists public.semi_stocks (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null,
  code text not null,
  market text default '국내',      -- 국내 / 해외
  chain text default '기타',       -- 밸류체인
  keywords text,
  priority text default '중',      -- 상 / 중 / 하
  created_at timestamptz default now(),
  unique (owner, code)
);

-- 2) 일일 브리핑 (뉴스 / 리포트 / 산업이슈)
create table if not exists public.semi_briefs (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  brief_date date not null,
  news jsonb default '[]',
  reports jsonb default '[]',
  issues jsonb default '[]',
  generated_at text,
  created_at timestamptz default now(),
  unique (owner, brief_date)
);

-- 3) 보안 규칙: 본인 데이터만
alter table public.semi_stocks enable row level security;
alter table public.semi_briefs enable row level security;

create policy "own semi_stocks" on public.semi_stocks
for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());

create policy "own semi_briefs" on public.semi_briefs
for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
