-- Migracja 528 (E24 przegląd 2026-11-08): R9 R10 R11 R19 R20.
-- Lokalna baza wg docs/sql/local-db.md (schema.sql + migracja 528).
\set ON_ERROR_STOP 1
begin;
\set a '52800000-0000-4000-8000-00000000000a'
\set b '52800000-0000-4000-8000-00000000000b'
insert into auth.users(id,email) values (:'a','a528@example.com'),(:'b','b528@example.com');
insert into public.profiles(id,username,email) values (:'a','alicja528','a528@example.com'),(:'b','Bartek528','b528@example.com') on conflict (id) do nothing;
insert into public.question_bases(id,owner_id,name) values ('52800000-0000-4000-8000-0000000000ba',:'b','Baza 528');
insert into public.poll_subscriptions(owner_id,subscriber_email,token) values (:'b','x528@example.com','52800000-0000-4000-8000-0000000000c1');
grant usage on schema auth to authenticated, anon;
grant execute on all functions in schema auth to authenticated, anon;
-- R19: martwe funkcje usunięte, R10: stara wyrocznia usunięta
do $$ begin
  if exists (select 1 from pg_proc where proname in ('cooldown_email_get','cooldown_email_release','cooldown_email_reserve','poll_go_owner_email_match') and pronamespace='public'::regnamespace)
    then raise exception 'stare funkcje nadal są'; end if;
  if has_function_privilege('anon','public.polls_hub_anon_voters(uuid,text)','execute') or has_function_privilege('authenticated','public.polls_hub_anon_voters(uuid,text)','execute')
    then raise exception 'polls_hub_anon_voters dla klientów'; end if;
end $$;
-- R11: nowa funkcja bez GRANT nie jest wykonywalna przez klientów
create function public.e24_528_probe() returns int language sql as $$ select 1 $$;
do $$ begin
  if has_function_privilege('anon','public.e24_528_probe()','execute') or has_function_privilege('authenticated','public.e24_528_probe()','execute')
    then raise exception 'domyślne prawa: nowa funkcja publiczna'; end if;
end $$;
-- R20: A nie pyta o dostęp B; B o siebie — tak
select set_config('request.jwt.claim.sub', :'a', true);
set local role authenticated;
do $$ begin
  if public.base_is_owner('52800000-0000-4000-8000-0000000000ba','52800000-0000-4000-8000-00000000000b') then raise exception 'base_is_owner: wyrocznia o innym koncie'; end if;
  if public.base_can_access('52800000-0000-4000-8000-0000000000ba','52800000-0000-4000-8000-00000000000b') then raise exception 'base_can_access: wyrocznia'; end if;
  if public.base_can_edit('52800000-0000-4000-8000-0000000000ba','52800000-0000-4000-8000-00000000000b') then raise exception 'base_can_edit: wyrocznia'; end if;
end $$;
reset role;
select set_config('request.jwt.claim.sub', :'b', true);
set local role authenticated;
do $$ begin
  if not public.base_is_owner('52800000-0000-4000-8000-0000000000ba','52800000-0000-4000-8000-00000000000b') then raise exception 'base_is_owner: właściciel'; end if;
  if not public.base_can_edit('52800000-0000-4000-8000-0000000000ba','52800000-0000-4000-8000-00000000000b') then raise exception 'base_can_edit: właściciel'; end if;
  if not public.base_can_access('52800000-0000-4000-8000-0000000000ba','52800000-0000-4000-8000-00000000000b') then raise exception 'base_can_access: właściciel'; end if;
end $$;
reset role;
-- R10: po tokenie zaproszenia tylko nazwa, nigdy adres
select set_config('request.jwt.claim.sub', '', true);
set local role anon;
do $$ declare t text; begin
  t := public.poll_go_owner_email_blocked('52800000-0000-4000-8000-0000000000c1', ' B528@example.com ');
  if t is distinct from 'Bartek528' then raise exception 'owner_email_blocked: %', t; end if;
  if public.poll_go_owner_email_blocked('52800000-0000-4000-8000-0000000000c1', 'a528@example.com') is not null then raise exception 'owner_email_blocked: obcy adres'; end if;
  if public.poll_go_owner_email_blocked(gen_random_uuid(), 'b528@example.com') is not null then raise exception 'owner_email_blocked: zły token'; end if;
end $$;
reset role;
-- R9: wynik tokenu udostępnienia bez adresów
do $$ declare n int; begin
  select count(*) into n from pg_proc where proname='base_share_token_info' and prosrc ~ '(op|p|t)[.](email|recipient_email)' ;
  if n > 0 then raise exception 'base_share_token_info zwraca adres'; end if;
end $$;
rollback;
\echo OK e24-review-528
