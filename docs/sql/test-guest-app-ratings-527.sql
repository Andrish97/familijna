-- Test migracji 527 (ocena systemu od gości). Lokalna baza wg docs/sql/local-db.md
-- (schema.sql + migracje od 514 jak w scripts/sql-gate.sh + 527):
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -v ON_ERROR_STOP=1 -f docs/sql/test-guest-app-ratings-527.sql
-- Wszystko w transakcji wycofanej na końcu.
\set ON_ERROR_STOP 1
begin;

-- Konta: B (zwykłe), G (gość), H (gość, który zamieni się w konto),
-- T (gość testowy e2e).
insert into auth.users(id, email, email_confirmed_at, is_anonymous, raw_app_meta_data) values
  ('b5270000-0000-4000-8000-00000000000b', 'r527-b@probe.test', now(), false, '{}'),
  ('95270000-0000-4000-8000-000000000009', null, null, true, '{}'),
  ('95270000-0000-4000-8000-00000000000a', null, null, true, '{}'),
  ('95270000-0000-4000-8000-00000000000e', null, null, true, '{"is_test_guest": "true"}');
insert into public.profiles(id, email, username, is_guest, guest_expires_at) values
  ('b5270000-0000-4000-8000-00000000000b', 'r527-b@probe.test', 'r527_b', false, null),
  ('95270000-0000-4000-8000-000000000009', null, 'r527_g', true, now() + interval '5 days'),
  ('95270000-0000-4000-8000-00000000000a', null, 'r527_h', true, now() + interval '5 days'),
  ('95270000-0000-4000-8000-00000000000e', null, 'r527_t', true, now() + interval '5 days');

create function pg_temp.as_user(p uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$ begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

-- 1. Gość wystawia ocenę; from_guest z przeglądarki (false) jest pomijane.
select pg_temp.as_user('95270000-0000-4000-8000-000000000009');
insert into public.app_ratings(user_id, stars, comment, from_guest) values (auth.uid(), 5, 'gość', false);
select pg_temp.as_user('95270000-0000-4000-8000-00000000000a');
insert into public.app_ratings(user_id, stars) values (auth.uid(), 4);
select pg_temp.as_user('95270000-0000-4000-8000-00000000000e');
insert into public.app_ratings(user_id, stars) values (auth.uid(), 1);
-- 2. Zwykłe konto próbuje udawać gościa.
select pg_temp.as_user('b5270000-0000-4000-8000-00000000000b');
insert into public.app_ratings(user_id, stars, from_guest) values (auth.uid(), 3, true);
-- 3. Komentarz ponad 2000 znaków nadal odrzucony (także dla gościa).
select pg_temp.as_user('95270000-0000-4000-8000-000000000009');
do $$ begin
  update public.app_ratings set comment = repeat('x', 2001) where user_id = auth.uid();
  raise exception 'FAIL: komentarz 2001 znaków przyjęty';
exception when insufficient_privilege or check_violation then null;
  when others then if sqlerrm like 'FAIL:%' then raise; end if;
end $$;
select pg_temp.as_admin();

do $$ begin
  if not (select from_guest from public.app_ratings where user_id = '95270000-0000-4000-8000-000000000009') then
    raise exception 'FAIL: ocena gościa bez from_guest'; end if;
  if (select from_guest from public.app_ratings where user_id = 'b5270000-0000-4000-8000-00000000000b') then
    raise exception 'FAIL: zwykłe konto oznaczone jako gość'; end if;
end $$;

-- 4. H zamienia się w konto (is_guest = false), potem wszystkie konta usuwane.
update public.profiles set is_guest = false where id = '95270000-0000-4000-8000-00000000000a';
select public.delete_user_everything('95270000-0000-4000-8000-000000000009');
select public.delete_user_everything('95270000-0000-4000-8000-00000000000a');
select public.delete_user_everything('95270000-0000-4000-8000-00000000000e');
select public.delete_user_everything('b5270000-0000-4000-8000-00000000000b');

do $$ declare n int; begin
  -- zostaje tylko ocena wygasłego gościa G (5 gwiazdek, bez konta, oznaczona)
  select count(*) into n from public.app_ratings where stars = 5 and comment = 'gość' and user_id is null and from_guest;
  if n <> 1 then raise exception 'FAIL: ocena gościa nie przetrwała usunięcia konta (%)', n; end if;
  select count(*) into n from public.app_ratings where stars in (4, 1, 3);
  if n <> 0 then raise exception 'FAIL: oceny konta, konta po zamianie lub testowego zostały (%)', n; end if;
end $$;

-- 5. Panel admina widzi znacznik, średnia liczy ocenę gościa.
do $$ begin
  if not exists (select 1 from public.get_ratings_admin() where comment = 'gość' and is_guest and user_id is null) then
    raise exception 'FAIL: get_ratings_admin bez oceny gościa'; end if;
  if (select total_count from public.get_app_rating_stats()) < 1 then
    raise exception 'FAIL: średnia bez oceny gościa'; end if;
end $$;

select 'OK: test-guest-app-ratings-527' as wynik;
rollback;
