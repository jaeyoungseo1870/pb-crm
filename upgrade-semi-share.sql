-- ============================================================
-- 업그레이드: 반도체 메뉴를 팀원(로그인 사용자)이 '보기'만 할 수 있게 공유
-- Supabase > SQL Editor 에 전체를 붙여넣고 Run (한 번만)
-- · 읽기: 로그인한 팀원 모두
-- · 추가/수정/삭제: 기존대로 등록한 본인(서재영)만
-- ============================================================

drop policy if exists "team read semi_stocks" on public.semi_stocks;
create policy "team read semi_stocks" on public.semi_stocks
for select to authenticated using (true);

drop policy if exists "team read semi_briefs" on public.semi_briefs;
create policy "team read semi_briefs" on public.semi_briefs
for select to authenticated using (true);
