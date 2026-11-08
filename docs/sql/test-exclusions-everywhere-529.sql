-- Test migracji 529 (wykluczenia ze statystyk wykluczają wszystko). Lokalna baza
-- wg docs/sql/local-db.md (schema.sql + migracje od 514 jak w scripts/sql-gate.sh):
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -v ON_ERROR_STOP=1 -f docs/sql/test-exclusions-everywhere-529.sql
-- Wszystko w transakcji wycofanej na końcu.
\set ON_ERROR_STOP 1
begin;
-- 528 odbiera domyślne EXECUTE nowym funkcjom; pomocnicze pg_temp.* testu
-- wołane jako authenticated muszą je mieć (cofane razem z transakcją).
alter default privileges grant execute on functions to public;
\ir ../../tests/sql/abuse-fixtures.sql

-- A, C: zwykłe konta; B: wykluczone ręcznie; T: konto testowe (e2e);
-- G: gość wykluczony ręcznie (jego ocena nie może zostać po wygaśnięciu konta).
insert into auth.users(id, email, email_confirmed_at, is_anonymous, raw_app_meta_data) values
  ('75290000-0000-4000-8000-000000000007', 'r529-t@probe.test', now(), false, '{"e2e_role":"standard"}'),
  ('95290000-0000-4000-8000-000000000009', null, null, true, '{}');
insert into public.profiles(id, email, username, is_guest, guest_expires_at) values
  ('75290000-0000-4000-8000-000000000007', 'r529-t@probe.test', 'r529_t', false, null),
  ('95290000-0000-4000-8000-000000000009', null, 'r529_g', true, now() + interval '5 days');
insert into public.stats_excluded_users(user_id) values
  ('b0000000-0000-4000-8000-00000000000b'), ('95290000-0000-4000-8000-000000000009');

-- Oceny systemu: A=5, C=4 (liczą się), B=1, T=1, G=1 (wykluczone).
insert into public.app_ratings(user_id, stars) values
  ('a0000000-0000-4000-8000-00000000000a', 5), ('c0000000-0000-4000-8000-00000000000c', 4),
  ('b0000000-0000-4000-8000-00000000000b', 1), ('75290000-0000-4000-8000-000000000007', 1),
  ('95290000-0000-4000-8000-000000000009', 1);

do $$ declare st jsonb; n int; begin
  st := public.get_admin_stats();
  if (st #>> '{ratings,total}')::int is distinct from 2 and (st->>'total_ratings')::int is distinct from 2 then
    raise exception 'FAIL: get_admin_stats liczy wykluczone oceny: %', st->'ratings';
  end if;
  select jsonb_array_length(coalesce(public.get_stats_detail('ratings'), '[]')) into n;
  if n <> 2 then raise exception 'FAIL: get_stats_detail(ratings) = % (oczekiwano 2)', n; end if;
  if (select total_count from public.get_app_rating_stats()) <> 2 then
    raise exception 'FAIL: get_app_rating_stats liczy wykluczone'; end if;
end $$;

-- Wykluczony gość wygasa: jego ocena znika (nie zostaje bez konta).
select public.delete_user_everything('95290000-0000-4000-8000-000000000009');
do $$ begin
  if exists (select 1 from public.app_ratings where user_id is null) then
    raise exception 'FAIL: ocena wykluczonego gościa została po usunięciu konta'; end if;
end $$;

-- Gry Społeczności: oceny i dodania A (5) i B (1, wykluczony ręcznie).
do $$ declare g uuid; begin
  select id into g from public.market_games order by id limit 1;
  insert into public.market_game_ratings(market_game_id, user_id, stars) values
    (g, 'a0000000-0000-4000-8000-00000000000a', 5), (g, 'b0000000-0000-4000-8000-00000000000b', 1);
  insert into public.user_market_library(user_id, market_game_id) values
    ('a0000000-0000-4000-8000-00000000000a', g), ('b0000000-0000-4000-8000-00000000000b', g);
  if (select (rating_count, avg_rating, library_count) from public.market_games where id = g) is distinct from (1, 5.00::numeric(3,2), 1) then
    raise exception 'FAIL: gra liczy wykluczone konto: %', (select (rating_count, avg_rating, library_count) from public.market_games where id = g);
  end if;
  -- zdjęcie wykluczenia B: przeliczenie od razu
  delete from public.stats_excluded_users where user_id = 'b0000000-0000-4000-8000-00000000000b';
  if (select (rating_count, avg_rating, library_count) from public.market_games where id = g) is distinct from (2, 3.00::numeric(3,2), 2) then
    raise exception 'FAIL: brak przeliczenia po zdjęciu wykluczenia: %', (select (rating_count, avg_rating, library_count) from public.market_games where id = g);
  end if;
  -- ponowne wykluczenie: znów bez B
  insert into public.stats_excluded_users(user_id) values ('b0000000-0000-4000-8000-00000000000b');
  if (select (rating_count, library_count) from public.market_games where id = g) is distinct from (1, 1) then
    raise exception 'FAIL: brak przeliczenia po wykluczeniu'; end if;
end $$;

select 'OK: test-exclusions-everywhere-529' as wynik;
rollback;
