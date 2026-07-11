-- ============================================================
-- PB 고객관리시스템 : Supabase 스키마
-- 사용법: Supabase 대시보드 > SQL Editor 에 전체를 붙여넣고 Run
-- ============================================================

-- 1) 팀원 프로필 (최대 3명 가입 제한)
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);

create or replace function public.check_member_limit()
returns trigger
language plpgsql security definer as $$
begin
  if (select count(*) from public.profiles) >= 3 then
    raise exception '가입 정원(3명)이 모두 찼습니다.';
  end if;
  return new;
end; $$;

create trigger member_limit
before insert on public.profiles
for each row execute function public.check_member_limit();

-- 2) 고객
create table public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text default '개인',            -- 개인/법인
  family text,                         -- 패밀리 그룹
  manager text,                        -- 담당자
  grade text default 'B',              -- VIP/A/B/C
  aum numeric,                         -- 백만원
  phone text,
  email text,
  memo text,
  categories text[] default '{}',      -- 주식/채권/해외/ELS/랩/펀드/부동산
  wrap jsonb,                          -- {fund, company, amount, date}
  created_at timestamptz default now()
);

-- 3) 수익률 이력
create table public.returns (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  base_date date not null,
  rate numeric not null,
  value numeric,
  memo text,
  created_at timestamptz default now()
);

-- 4) 잠재고객
create table public.prospects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  manager text,
  expected_asset numeric,
  cycle int default 30,                -- 7=주간, 30=월간, 90=분기
  last_contact date,
  source text,
  memo text,
  interests text[] default '{}',
  created_at timestamptz default now()
);

-- 5) 보안 규칙(RLS): 로그인한 팀원만 읽기/쓰기 가능
alter table public.profiles  enable row level security;
alter table public.clients   enable row level security;
alter table public.returns   enable row level security;
alter table public.prospects enable row level security;

create policy "team read profiles"  on public.profiles  for select to authenticated using (true);
create policy "insert own profile"  on public.profiles  for insert to authenticated with check (auth.uid() = id);

create policy "team all clients"    on public.clients   for all to authenticated using (true) with check (true);
create policy "team all returns"    on public.returns   for all to authenticated using (true) with check (true);
create policy "team all prospects"  on public.prospects  for all to authenticated using (true) with check (true);
