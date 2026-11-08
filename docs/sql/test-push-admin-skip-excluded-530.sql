-- Test migracji 530 (powiadomienia admina bez kont wykluczonych). Lokalna baza
-- wg docs/sql/local-db.md (schema.sql + migracje od 514 jak w scripts/sql-gate.sh):
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -v ON_ERROR_STOP=1 -f docs/sql/test-push-admin-skip-excluded-530.sql
-- Wszystko w transakcji wycofanej na końcu.
\set ON_ERROR_STOP 1
begin;
alter default privileges grant execute on functions to public;

-- Konta: A (zwykłe), T (testowe e2e), M (wykluczone ręcznie); subskrypcja admina.
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data) values
  ('a5300000-0000-4000-8000-00000000000a', 'r530-a@probe.test', now(), '{}'),
  ('75300000-0000-4000-8000-000000000007', 'r530-t@probe.test', now(), '{"e2e_role":"standard"}'),
  ('d5300000-0000-4000-8000-00000000000d', 'r530-m@probe.test', now(), '{}');
insert into public.profiles(id, email, username, is_guest) values
  ('a5300000-0000-4000-8000-00000000000a', 'r530-a@probe.test', 'r530_a', false),
  ('75300000-0000-4000-8000-000000000007', 'r530-t@probe.test', 'r530_t', false),
  ('d5300000-0000-4000-8000-00000000000d', 'r530-m@probe.test', 'r530_m', false);
insert into public.stats_excluded_users(user_id) values ('d5300000-0000-4000-8000-00000000000d');
insert into public.push_subscriptions(app, endpoint, p256dh, auth) values ('admin', 'https://push.probe.test/endpoint-1', repeat('k', 87), repeat('a', 22));

create temp table n0 as select count(*) c from public.push_outbox where app = 'admin';

-- Gry do moderacji: od A (powiadomienie), od T i M (bez powiadomienia).
insert into public.market_games(author_user_id, title, lang, payload, status, origin) values
  ('75300000-0000-4000-8000-000000000007', 't', 'pl', '{}', 'pending', 'community'),
  ('d5300000-0000-4000-8000-00000000000d', 'm', 'pl', '{}', 'pending', 'community');
do $$ begin
  if (select count(*) from public.push_outbox where app = 'admin') <> (select c from n0) then
    raise exception 'FAIL: powiadomienie o grze konta wykluczonego'; end if;
end $$;
insert into public.market_games(author_user_id, title, lang, payload, status, origin) values
  ('a5300000-0000-4000-8000-00000000000a', 'a', 'pl', '{}', 'pending', 'community');
do $$ begin
  if (select count(*) from public.push_outbox where app = 'admin' and event = 'market') <> 1 then
    raise exception 'FAIL: brak powiadomienia o grze zwykłego konta'; end if;
end $$;

-- Poczta: z adresu testowego i konta wykluczonego -- bez powiadomienia; zwykły -- jest.
insert into public.messages(source, direction, from_email, subject) values
  ('email', 'inbound', 'e2e+standard01@familiada.online', 's'),
  ('email', 'inbound', 'r530-m@probe.test', 's');
do $$ begin
  if exists (select 1 from public.push_outbox where app = 'admin' and event = 'mail') then
    raise exception 'FAIL: powiadomienie o mailu z adresu wykluczonego'; end if;
end $$;
insert into public.messages(source, direction, from_email, subject) values ('email', 'inbound', 'ktos@probe.test', 's');
do $$ begin
  if (select count(*) from public.push_outbox where app = 'admin' and event = 'mail') <> 1 then
    raise exception 'FAIL: brak powiadomienia o zwykłym mailu'; end if;
end $$;

select 'OK: test-push-admin-skip-excluded-530' as wynik;
rollback;
