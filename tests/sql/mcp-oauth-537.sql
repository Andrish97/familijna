-- Migracja 537: OAuth serwera MCP. Uruchomienie: lokalna baza wg
-- docs/sql/local-db.md (schema.sql + migracje od 514 + 535 + 537), potem:
-- psql ... -d fam -f tests/sql/mcp-oauth-537.sql
\set ON_ERROR_STOP 1
begin;
-- od migracji 538 czat widzą tylko konta wg ai_limits.chat_audience — tu wszyscy
do $$ begin
  if to_regclass('public.ai_limits') is not null then update public.ai_limits set chat_audience = 'all' where id = 1; end if;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
  ('53700000-0000-4000-8000-0000000000aa','a537@x.pl',now()),
  ('53700000-0000-4000-8000-0000000000cc',null,null);
insert into public.profiles(id, username, is_guest) values
  ('53700000-0000-4000-8000-0000000000aa','a537',false),
  ('53700000-0000-4000-8000-0000000000cc','g537',true)
on conflict (id) do update set is_guest = excluded.is_guest;

-- weryfikator PKCE i jego S256 (RFC 7636, przykład z dodatku B)
create function pg_temp.verifier() returns text language sql as $$ select 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' $$;
create function pg_temp.challenge() returns text language sql as $$ select 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM' $$;

do $$
begin
  if public._mcp_s256(pg_temp.verifier()) <> pg_temp.challenge() then raise exception 'S256 niezgodne z RFC 7636'; end if;
end $$;

set local role anon;
do $$
declare r jsonb; c uuid; q uuid;
begin
  if public.mcp_client_register('Claude', array['javascript:alert(1)'])->>'error' <> 'invalid_redirect_uri' then raise exception 'zły adres powrotu przyjęty'; end if;
  r := public.mcp_client_register('Claude', array['https://claude.ai/api/mcp/auth_callback', 'http://localhost:6274/cb']);
  c := (r->>'client_id')::uuid;
  if public.mcp_authorize_begin(c, 'https://evil.example/cb', pg_temp.challenge(), 's')->>'error' <> 'invalid_redirect_uri' then raise exception 'obcy adres powrotu'; end if;
  if public.mcp_authorize_begin(c, 'https://claude.ai/api/mcp/auth_callback', 'krotkie', 's')->>'error' <> 'invalid_request' then raise exception 'krótkie wyzwanie'; end if;
  r := public.mcp_authorize_begin(c, 'https://claude.ai/api/mcp/auth_callback', pg_temp.challenge(), 'st&1');
  q := (r->>'request_id')::uuid;
  perform set_config('t.client', c::text, false);
  perform set_config('t.request', q::text, false);
end $$;

-- anon nie zobaczy prośby ani nie zdecyduje
do $$
begin
  perform public.mcp_authorize_info(current_setting('t.request')::uuid);
  raise exception 'anon: mcp_authorize_info dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;

set local role authenticated;
do $$
declare r jsonb; code text; tok text; q2 uuid;
begin
  -- gość nie może zgodzić się na dostęp
  perform set_config('request.jwt.claim.sub', '53700000-0000-4000-8000-0000000000cc', true);
  if public.mcp_authorize_decide(current_setting('t.request')::uuid, true)->>'error' <> 'registered_account_required' then raise exception 'gość'; end if;

  perform set_config('request.jwt.claim.sub', '53700000-0000-4000-8000-0000000000aa', true);
  r := public.mcp_authorize_info(current_setting('t.request')::uuid);
  if r->>'client_name' <> 'Claude' or r->>'redirect_host' <> 'claude.ai' then raise exception 'info: %', r; end if;
  r := public.mcp_authorize_decide(current_setting('t.request')::uuid, true);
  if r->>'redirect' !~ '^https://claude\.ai/api/mcp/auth_callback\?code=[0-9a-f]{64}&state=st%261$' then raise exception 'redirect: %', r; end if;
  code := substring(r->>'redirect' from 'code=([0-9a-f]{64})');
  if public.mcp_authorize_decide(current_setting('t.request')::uuid, true)->>'error' <> 'expired' then raise exception 'druga decyzja'; end if;

  -- wymiana: zły weryfikator, obcy adres, potem poprawna, potem ponownie (jednorazowy)
  if public.mcp_token_exchange(code, 'x' || pg_temp.verifier(), current_setting('t.client')::uuid, 'https://claude.ai/api/mcp/auth_callback')->>'error' <> 'invalid_grant' then raise exception 'zły weryfikator'; end if;
  if public.mcp_token_exchange(code, pg_temp.verifier(), current_setting('t.client')::uuid, 'http://localhost:6274/cb')->>'error' <> 'invalid_grant' then raise exception 'inny adres'; end if;
  r := public.mcp_token_exchange(code, pg_temp.verifier(), current_setting('t.client')::uuid, 'https://claude.ai/api/mcp/auth_callback');
  tok := r->>'access_token';
  if tok !~ '^fam_mcp_[0-9a-f]{64}$' then raise exception 'token: %', r; end if;
  if public.mcp_token_exchange(code, pg_temp.verifier(), current_setting('t.client')::uuid, 'https://claude.ai/api/mcp/auth_callback')->>'error' <> 'invalid_grant' then raise exception 'kod drugi raz'; end if;
  perform set_config('t.token', tok, false);

  -- moje połączenia
  r := public.mcp_tokens_mine();
  if jsonb_array_length(r->'tokens') <> 1 or r->'tokens'->0->>'client_name' <> 'Claude' then raise exception 'mine: %', r; end if;
  perform set_config('t.token_id', r->'tokens'->0->>'id', false);

  -- odmowa: adres z error=access_denied
  q2 := (public.mcp_authorize_begin(current_setting('t.client')::uuid, 'http://localhost:6274/cb', pg_temp.challenge(), null)->>'request_id')::uuid;
  if public.mcp_authorize_decide(q2, false)->>'redirect' <> 'http://localhost:6274/cb?error=access_denied' then raise exception 'odmowa'; end if;
end $$;

-- token → użytkownik tylko dla service_role
do $$
begin
  perform public.mcp_token_user(current_setting('t.token'));
  raise exception 'authenticated: mcp_token_user dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;

do $$
declare r jsonb;
begin
  r := public.mcp_token_user(current_setting('t.token'));
  if r->>'user_id' <> '53700000-0000-4000-8000-0000000000aa' then raise exception 'token_user: %', r; end if;
  if public.mcp_token_user('fam_mcp_zly')->>'error' <> 'invalid_token' then raise exception 'zły token'; end if;
end $$;

set local role authenticated;
do $$
begin
  perform set_config('request.jwt.claim.sub', '53700000-0000-4000-8000-0000000000aa', true);
  if not (public.mcp_token_revoke(current_setting('t.token_id')::uuid)->>'revoked')::boolean then raise exception 'revoke'; end if;
end $$;
reset role;
do $$
begin
  if public.mcp_token_user(current_setting('t.token'))->>'error' <> 'invalid_token' then raise exception 'odwołany token działa'; end if;
end $$;

-- tabel nie czyta nikt poza funkcjami
set local role authenticated;
do $$
begin
  perform 1 from public.mcp_tokens;
  raise exception 'authenticated: mcp_tokens dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'mcp-oauth-537: OK' as wynik;
rollback;
