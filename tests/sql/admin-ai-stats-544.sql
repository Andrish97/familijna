-- Migracja 544: podsumowanie czatu AI dla panelu admina (admin_ai_limits_get.totals).
\set ON_ERROR_STOP 1
begin;
do $$
declare r jsonb;
begin
  r := public.admin_ai_limits_get();
  if r->'limits' is null or r->'usage' is null then raise exception 'brak limits/usage: %', r; end if;
  if (select count(*) from jsonb_object_keys(r->'totals')) <> 12 then raise exception 'totals: %', r->'totals'; end if;
end $$;
set local role authenticated;
do $$
begin
  perform public.admin_ai_limits_get();
  raise exception 'authenticated: admin_ai_limits_get dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'admin-ai-stats-544: OK' as wynik;
rollback;
