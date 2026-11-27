-- Migracja 545: statystyki czatu AI w panelu admina — konta testowe i wykluczone osobno
-- (stats_exclusions_effective: konta e2e, goście testowi, wykluczenia ręczne).
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id, email, raw_app_meta_data) values
 ('00000000-0000-4000-8000-0000000545a1', 'zwykly545@example.test', '{}'),
 ('00000000-0000-4000-8000-0000000545b2', 'reczny545@example.test', '{}'),
 ('00000000-0000-4000-8000-0000000545c3', 'e2e545@example.test', '{"e2e_role":"standard"}');
insert into public.profiles(id, username, email) values
 ('00000000-0000-4000-8000-0000000545a1', 'zwykly545', 'zwykly545@example.test'),
 ('00000000-0000-4000-8000-0000000545b2', 'reczny545', 'reczny545@example.test'),
 ('00000000-0000-4000-8000-0000000545c3', 'e2e545', 'e2e545@example.test')
 on conflict (id) do nothing;
insert into public.stats_excluded_users(user_id) values ('00000000-0000-4000-8000-0000000545b2');
create temp table przed as select public.admin_ai_limits_get()->'totals' as t, public.admin_ai_limits_get()->'totals_excluded' as x;
insert into public.ai_usage(user_id, day, messages, steps) values
 ('00000000-0000-4000-8000-0000000545a1', public._ai_today(), 3, 5),
 ('00000000-0000-4000-8000-0000000545b2', public._ai_today(), 7, 9),
 ('00000000-0000-4000-8000-0000000545c3', public._ai_today(), 11, 13);
do $$
declare a jsonb := (select t from przed); b jsonb := public.admin_ai_limits_get()->'totals';
  xa jsonb := (select x from przed); xb jsonb := public.admin_ai_limits_get()->'totals_excluded'; d jsonb;
begin
  if (b->>'today_users')::int - (a->>'today_users')::int <> 1 then raise exception 'today_users: % → %', a, b; end if;
  if (b->>'today_messages')::int - (a->>'today_messages')::int <> 3 then raise exception 'today_messages: % → %', a, b; end if;
  if (b->>'messages_30d')::int - (a->>'messages_30d')::int <> 3 then raise exception 'messages_30d: % → %', a, b; end if;
  if (xb->>'today_users')::int - (xa->>'today_users')::int <> 2 then raise exception 'excluded today_users: % → %', xa, xb; end if;
  if (xb->>'today_messages')::int - (xa->>'today_messages')::int <> 18 then raise exception 'excluded today_messages: % → %', xa, xb; end if;
  if (select count(*) from jsonb_object_keys(xb)) <> 12 then raise exception 'totals_excluded: %', xb; end if;
  select u into d from jsonb_array_elements(public.admin_ai_limits_get()->'usage') u where (u->>'day')::date = public._ai_today();
  if (d->>'messages')::int <> (a->>'today_messages')::int + 3 then raise exception 'usage messages: %', d; end if;
  if (d->>'excluded_messages')::int <> (xa->>'today_messages')::int + 18 or (d->>'excluded_users')::int <> (xa->>'today_users')::int + 2 then raise exception 'usage excluded: %', d; end if;
end $$;
set local role authenticated;
do $$
begin
  perform public.admin_ai_limits_get();
  raise exception 'authenticated: admin_ai_limits_get dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'admin-ai-stats-545: OK' as wynik;
rollback;
