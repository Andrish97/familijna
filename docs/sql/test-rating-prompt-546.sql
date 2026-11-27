-- Test migracji 546 (zdarzenia prośby o ocenę, lejek admina). Lokalna baza wg
-- docs/sql/local-db.md (schema.sql + migracje jak w scripts/sql-gate.sh + 546):
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -v ON_ERROR_STOP=1 -f docs/sql/test-rating-prompt-546.sql
-- Wszystko w transakcji wycofanej na końcu.
\set ON_ERROR_STOP 1
begin;
alter default privileges grant execute on functions to public;

-- Konta: B (zwykłe), G (gość), T (gość testowy e2e).
insert into auth.users(id, email, email_confirmed_at, is_anonymous, raw_app_meta_data) values
  ('b5460000-0000-4000-8000-00000000000b', 'r546-b@probe.test', now(), false, '{}'),
  ('95460000-0000-4000-8000-000000000009', null, null, true, '{}'),
  ('95460000-0000-4000-8000-00000000000e', null, null, true, '{"is_test_guest": "true"}');
insert into public.profiles(id, email, username, is_guest, guest_expires_at) values
  ('b5460000-0000-4000-8000-00000000000b', 'r546-b@probe.test', 'r546_b', false, null),
  ('95460000-0000-4000-8000-000000000009', null, 'r546_g', true, now() + interval '5 days'),
  ('95460000-0000-4000-8000-00000000000e', null, 'r546_t', true, now() + interval '5 days');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$ begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1. Zapis przez RPC: konto, gość, gość testowy.
select pg_temp.as_user('b5460000-0000-4000-8000-00000000000b');
do $$ begin
  if not public.app_rating_prompt_log('shown', 'games') then raise exception 'FAIL: shown odrzucone'; end if;
  if not public.app_rating_prompt_log('sent', 'games') then raise exception 'FAIL: sent odrzucone'; end if;
  if public.app_rating_prompt_log('hacked', 'games') then raise exception 'FAIL: zły outcome przyjęty'; end if;
  if public.app_rating_prompt_log('shown', 'games/../x') then raise exception 'FAIL: zła strona przyjęta'; end if;
end $$;
-- 2. Strona nie zapisze wprost ani nie odczyta tabeli.
do $$ begin
  insert into public.app_rating_prompt_events(user_id, outcome, page) values (auth.uid(), 'sent', 'games');
  raise exception 'FAIL: zapis wprost przyjęty';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform 1 from public.app_rating_prompt_events;
  raise exception 'FAIL: odczyt wprost przyjęty';
exception when insufficient_privilege then null;
end $$;
do $$ begin
  perform public.get_rating_prompt_funnel();
  raise exception 'FAIL: lejek dostępny dla authenticated';
exception when insufficient_privilege then null;
end $$;
select pg_temp.as_user('95460000-0000-4000-8000-000000000009');
select public.app_rating_prompt_log('shown', 'account');
select public.app_rating_prompt_log('closed', 'account');
select pg_temp.as_user('95460000-0000-4000-8000-00000000000e');
select public.app_rating_prompt_log('shown', 'games');
select public.app_rating_prompt_log('never', 'games');
-- 3. Limit 40 na dobę.
select pg_temp.as_user('b5460000-0000-4000-8000-00000000000b');
do $$ declare i int; begin
  for i in 1..45 loop perform public.app_rating_prompt_log('later', 'bases'); end loop;
end $$;
select pg_temp.as_admin();
do $$ begin
  if (select count(*) from public.app_rating_prompt_events where user_id = 'b5460000-0000-4000-8000-00000000000b') <> 40 then
    raise exception 'FAIL: limit 40 na dobę'; end if;
  if not (select bool_and(from_guest) from public.app_rating_prompt_events where user_id = '95460000-0000-4000-8000-000000000009') then
    raise exception 'FAIL: gość bez from_guest'; end if;
  if not (select bool_and(test_account) from public.app_rating_prompt_events where user_id = '95460000-0000-4000-8000-00000000000e') then
    raise exception 'FAIL: gość testowy bez test_account'; end if;
end $$;
-- 4. Lejek: bez konta testowego; po usunięciu konta zdarzenia zostają (user_id null).
delete from public.profiles where id in ('95460000-0000-4000-8000-000000000009', '95460000-0000-4000-8000-00000000000e');
do $$ declare f jsonb := public.get_rating_prompt_funnel(); begin
  raise notice 'lejek: %', f;
  if (f->'d7'->>'shown')::int <> 2 then raise exception 'FAIL: shown 7d = %', f->'d7'->>'shown'; end if;
  if (f->'d7'->>'sent')::int <> 1 then raise exception 'FAIL: sent 7d'; end if;
  if (f->'d7'->>'never')::int <> 0 then raise exception 'FAIL: never konta testowego policzone'; end if;
  if (f->'d7'->>'closed')::int <> 1 then raise exception 'FAIL: closed 7d'; end if;
  if (f->'d30'->>'later')::int <> 38 then raise exception 'FAIL: later 30d = %', f->'d30'->>'later'; end if;
  if (f->'d7'->>'guest_shown')::int <> 1 then raise exception 'FAIL: guest_shown'; end if;
end $$;
rollback;
\echo OK test-rating-prompt-546
