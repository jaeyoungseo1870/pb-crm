-- ============================================================
-- 업그레이드: 잠재고객에 회사명 추가
-- Supabase > SQL Editor 에 아래 내용을 붙여넣고 Run
-- ============================================================

alter table public.prospects
  add column if not exists company text;
