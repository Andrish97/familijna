-- Migracja 541: osobiste klucze API Familijnej (decyzja 35). Uruchomienie:
-- lokalna baza wg docs/sql/local-db.md (… + 537 + 538 + 541), potem:
-- psql ... -d fam -f tests/sql/ai-api-keys-541.sql
\set ON_ERROR_STOP 1
begin;
update public.ai_limits set chat_audience = 'all' where id = 1;
insert into auth.users(id,email,email_confirmed_at) values
  ('54100000-0000-4000-8000-0000000000aa','a541@x.pl',now()),
  ('54100000-0000-4000-8000-0000000000bb','b541@x.pl',now()),
  ('54100000-0000-4000-8000-0000000000cc',null,null);
insert into public.profiles(id, username, is_guest) values
  ('54100000-0000-4000-8000-0000000000aa','a541',false),
  ('54100000-0000-4000-8000-0000000000bb','b541',false),
  ('54100000-0000-4000-8000-0000000000cc','g541',true)
on conflict (id) do update set is_guest = excluded.is_guest;

set local role authenticated;
do $$
declare r jsonb; i int;
begin
  -- gość: bez kluczy
  perform set_config('request.jwt.claim.sub', '54100000-0000-4000-8000-0000000000cc', true);
  if public.mcp_api_key_create('x')->>'error' <> 'registered_account_required' then raise exception 'gość dostał klucz'; end if;

  perform set_config('request.jwt.claim.sub', '54100000-0000-4000-8000-0000000000aa', true);
  if public.mcp_api_key_create('  ')->>'error' <> 'invalid_name' then raise exception 'pusta nazwa'; end if;
  if public.mcp_api_key_create(repeat('a', 61))->>'error' <> 'invalid_name' then raise exception 'za długa nazwa'; end if;
  r := public.mcp_api_key_create('Mój GPT');
  if not (r->>'ok')::boolean or r->>'token' !~ '^fam_key_[0-9a-f]{64}$' then raise exception 'zły klucz: %', r; end if;
  perform set_config('t.token', r->>'token', false);
  perform set_config('t.id', r->>'id', false);
  -- lista: rodzaj api_key, bez daty wygaśnięcia
  r := public.mcp_tokens_mine();
  if r->'tokens'->0->>'kind' <> 'api_key' or r->'tokens'->0->'expires_at' <> 'null'::jsonb then raise exception 'lista: %', r; end if;
  if r::text like '%fam_key_%' then raise exception 'lista zdradza klucz'; end if;
  -- limit 10 aktywnych
  for i in 2..10 loop perform public.mcp_api_key_create('k' || i); end loop;
  if public.mcp_api_key_create('k11')->>'error' <> 'too_many_keys' then raise exception 'limit aktywnych'; end if;
end $$;
reset role;

-- klucz działa jak token łącznika (serwer: mcp_token_user), w bazie tylko skrót
do $$
declare r jsonb;
begin
  r := public.mcp_token_user(current_setting('t.token'));
  if not (r->>'ok')::boolean or r->>'user_id' <> '54100000-0000-4000-8000-0000000000aa' then raise exception 'klucz nie działa: %', r; end if;
  if exists (select 1 from public.mcp_tokens where token_hash = current_setting('t.token')) then raise exception 'klucz jawnie w bazie'; end if;
end $$;

-- cudzy klucz: nie odwoła; własny: odwołanie wyłącza klucz
set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '54100000-0000-4000-8000-0000000000bb', true);
  if (public.mcp_token_revoke(current_setting('t.id')::uuid)->>'revoked')::boolean then raise exception 'cudzy klucz odwołany'; end if;
  if jsonb_array_length(public.mcp_tokens_mine()->'tokens') <> 0 then raise exception 'cudze klucze widoczne'; end if;
  perform set_config('request.jwt.claim.sub', '54100000-0000-4000-8000-0000000000aa', true);
  if not (public.mcp_token_revoke(current_setting('t.id')::uuid)->>'revoked')::boolean then raise exception 'odwołanie'; end if;
end $$;
reset role;
do $$
begin
  if public.mcp_token_user(current_setting('t.token'))->>'error' <> 'invalid_token' then raise exception 'odwołany klucz działa'; end if;
end $$;

-- anon nie tworzy kluczy
set local role anon;
do $$
begin
  perform public.mcp_api_key_create('x');
  raise exception 'anon: mcp_api_key_create dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'ai-api-keys-541: OK' as wynik;
rollback;
