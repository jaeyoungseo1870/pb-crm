-- ============================================================
-- 업그레이드: 반도체 > 종목분석 (상세 분석·리포트 요약) 테이블
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (한 번만)
-- · 읽기: 로그인한 팀원 모두 / 작성·수정·삭제: 작성한 본인만
-- ============================================================
create table if not exists public.semi_analysis (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code text not null,              -- 관심종목 코드(또는 종목명)
  title text not null,
  analysis_date date default current_date,
  rating text,                     -- 투자의견/관점 (예: 관망, 매수, 중립)
  target_price numeric,
  currency text default 'KRW',
  summary text,                    -- 핵심 요약 (목록에 표시)
  content text,                    -- 본문 (## 제목, - 목록, **굵게**, | 표 | 지원)
  sources jsonb default '[]',      -- [{"title":"...","url":"..."}]
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.semi_analysis enable row level security;
drop policy if exists "own semi_analysis" on public.semi_analysis;
create policy "own semi_analysis" on public.semi_analysis
for all to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
drop policy if exists "team read semi_analysis" on public.semi_analysis;
create policy "team read semi_analysis" on public.semi_analysis
for select to authenticated using (true);
