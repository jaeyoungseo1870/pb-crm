-- ============================================================
-- 업그레이드: 반도체 > 기술동향 (종목분석 테이블에 구분 컬럼 추가)
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (한 번만)
-- 기존 종목분석 글은 kind='stock' 으로 그대로 유지됩니다.
-- ============================================================
alter table public.semi_analysis add column if not exists kind text default 'stock';
alter table public.semi_analysis add column if not exists category text;   -- 기술 분야
alter table public.semi_analysis add column if not exists related text;    -- 관련 종목(쉼표 구분)
alter table public.semi_analysis alter column code drop not null;
