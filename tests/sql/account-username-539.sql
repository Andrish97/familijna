-- Migracja 539: account_set_username. Lokalna baza + migracje do 539:
-- psql ... -d fam -f tests/sql/account-username-539.sql
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id,email,email_confirmed_at) values
  ('53900000-0000-4000-8000-0000000000aa','a539@x.pl',now()),
  ('53900000-0000-4000-8000-0000000000bb','b539@x.pl',now()),
  ('53900000-0000-4000-8000-0000000000cc',null,null);
insert into public.profiles(id, username, is_guest) values
  ('53900000-0000-4000-8000-0000000000aa','a539',false),
  ('53900000-0000-4000-8000-0000000000bb','zajeta539',false),
  ('53900000-0000-4000-8000-0000000000cc','g539',true)
on conflict (id) do update set username = excluded.username, is_guest = excluded.is_guest;
set local role authenticated;
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '53900000-0000-4000-8000-0000000000aa', true);
  if public.account_set_username('ab')->>'error' <> 'invalid' then raise exception 'krótka'; end if;
  if public.account_set_username('guest_x1')->>'error' <> 'invalid' then raise exception 'guest_'; end if;
  if public.account_set_username('ZAJETA539')->>'error' <> 'taken' then raise exception 'zajęta'; end if;
  r := public.account_set_username('  nowa.539 ');
  if not (r->>'ok')::boolean or r->>'username' <> 'nowa.539' then raise exception 'zmiana: %', r; end if;
  if (select username from public.profiles where id = '53900000-0000-4000-8000-0000000000aa') <> 'nowa.539' then raise exception 'profil'; end if;
  r := public.account_set_username('jeszcze539');
  if r->>'error' <> 'cooldown' or r->>'next_allowed_at' is null then raise exception 'limit: %', r; end if;
  if not (public.account_set_username('nowa.539')->>'unchanged')::boolean then raise exception 'bez zmiany'; end if;
  perform set_config('request.jwt.claim.sub', '53900000-0000-4000-8000-0000000000cc', true);
  if public.account_set_username('gosc539')->>'error' <> 'not_registered' then raise exception 'gość'; end if;
end $$;
rollback;
\echo account-username-539 OK
