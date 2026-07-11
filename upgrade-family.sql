-- ============================================================
-- 업그레이드: 패밀리 고객 연결 (주고객 → 가족 고객 복수 연결)
-- Supabase > SQL Editor 에 붙여넣고 Run
-- (기존 데이터는 건드리지 않습니다)
-- ============================================================

alter table public.clients
  add column if not exists family_head uuid references public.clients(id) on delete set null;

create index if not exists idx_clients_family_head on public.clients(family_head);
