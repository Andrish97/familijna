-- Migracja 545: statystyki czatu AI rozdzielone (asystent Familijnej, własne
-- klucze, łącznik MCP / API), konta testowe i wykluczone osobno.
\set ON_ERROR_STOP 1
begin;
update public.ai_limits set chat_audience = 'all' where id = 1;
insert into auth.users(id, email, email_confirmed_at, raw_app_meta_data) values
 ('00000000-0000-4000-8000-0000000545a1', 'zwykly545@example.test', now(), '{}'),
 ('00000000-0000-4000-8000-0000000545b2', 'reczny545@example.test', now(), '{}'),
 ('00000000-0000-4000-8000-0000000545c3', 'e2e545@example.test', now(), '{"e2e_role":"standard"}');
insert into public.profiles(id, username, email, is_guest) values
 ('00000000-0000-4000-8000-0000000545a1', 'zwykly545', 'zwykly545@example.test', false),
 ('00000000-0000-4000-8000-0000000545b2', 'reczny545', 'reczny545@example.test', false),
 ('00000000-0000-4000-8000-0000000545c3', 'e2e545', 'e2e545@example.test', false)
 on conflict (id) do nothing;
insert into public.stats_excluded_users(user_id) values ('00000000-0000-4000-8000-0000000545b2');
create temp table przed as select public.admin_ai_limits_get() as r;
insert into public.mcp_tokens(id, user_id, client_name, token_hash, expires_at, kind, last_used_at) values
 ('00000000-0000-4000-8000-00000545f001', '00000000-0000-4000-8000-0000000545a1', 'Claude', 'h545a', now() + interval '30 days', 'oauth', now()),
 ('00000000-0000-4000-8000-00000545f002', '00000000-0000-4000-8000-0000000545a1', 'Moje prywatne', 'h545b', now() + interval '10 years', 'api_key', null),
 ('00000000-0000-4000-8000-00000545f003', '00000000-0000-4000-8000-0000000545c3', 'Claude', 'h545c', now() + interval '30 days', 'oauth', now());

-- wiadomości użytkownika w różnych formatach historii (wyniki narzędzi się nie liczą)
do $$ begin
  if public._ai_user_messages('[{"role":"user","parts":[{"text":"a"}]},{"role":"model","parts":[{"text":"b"}]},
      {"role":"user","parts":[{"functionResponse":{"name":"x","response":{}}}]},{"role":"user","content":"c"},
      {"role":"user","content":[{"type":"tool_result","tool_use_id":"1","content":"r"}]},{"role":"tool","content":"t"}]') <> 2
  then raise exception '_ai_user_messages'; end if;
end $$;

-- 1. asystent Familijnej: ai_usage (zwykły 3, wykluczony 7, e2e 11)
insert into public.ai_usage(user_id, day, messages, steps) values
 ('00000000-0000-4000-8000-0000000545a1', public._ai_today(), 3, 5),
 ('00000000-0000-4000-8000-0000000545b2', public._ai_today(), 7, 9),
 ('00000000-0000-4000-8000-0000000545c3', public._ai_today(), 11, 13);

-- 2. własne klucze: zapis rozmowy liczy przyrost; asystent Familijnej nie
set local role authenticated;
do $$
declare r jsonb; id1 uuid;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000545a1', true);
  r := public.ai_chat_save(null, 'A', 'openai', 'm', '[{"role":"user","content":"1"}]');
  id1 := (r->>'id')::uuid;
  r := public.ai_chat_save(id1, 'A', 'openai', 'm', '[{"role":"user","content":"1"},{"role":"assistant","content":"x"},{"role":"user","content":"2"},{"role":"tool","content":"t"}]');
  r := public.ai_chat_save(id1, 'A', 'openai', 'm', '[{"role":"user","content":"1"},{"role":"assistant","content":"x"},{"role":"user","content":"2"},{"role":"tool","content":"t"}]');
  r := public.ai_chat_save(null, 'B', 'familijna', 'g', '[{"role":"user","parts":[{"text":"1"}]}]');
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000545c3', true);
  r := public.ai_chat_save(null, 'C', 'gemini', 'g', '[{"role":"user","parts":[{"text":"1"}]},{"role":"user","parts":[{"text":"2"}]}]');
  if not (r->>'ok')::boolean then raise exception 'save: %', r; end if;
end $$;
reset role;

-- 3. łącznik: wywołania narzędzi (klucz API pod nazwą „API”)
do $$ begin
  perform public.mcp_usage_record('00000000-0000-4000-8000-00000545f001', 'list_games', true);
  perform public.mcp_usage_record('00000000-0000-4000-8000-00000545f001', 'list_games', false);
  perform public.mcp_usage_record('00000000-0000-4000-8000-00000545f002', 'search_manual', true);
  perform public.mcp_usage_record('00000000-0000-4000-8000-00000545f003', 'list_games', true);
  perform public.mcp_usage_record('00000000-0000-4000-8000-00000545f001', 'Zła Nazwa!', true);
end $$;

do $$
declare
  a jsonb := (select r from przed); r jsonb := public.admin_ai_limits_get();
  t jsonb := r->'totals'; x jsonb := r->'totals_excluded'; ta jsonb := a->'totals'; xa jsonb := a->'totals_excluded'; d jsonb;
begin
  -- asystent
  if (t->>'today_messages')::int - (ta->>'today_messages')::int <> 3 then raise exception 'builtin: % → %', ta, t; end if;
  if (x->>'today_messages')::int - (xa->>'today_messages')::int <> 18 then raise exception 'builtin x: % → %', xa, x; end if;
  if (t->>'chats')::int - (ta->>'chats')::int <> 1 then raise exception 'builtin chats: %', t; end if;
  -- własne klucze: zwykły 2 wiadomości openai (zapis bez zmian nie liczy), e2e 2 gemini
  if (t->'own'->>'today_messages')::int - (ta->'own'->>'today_messages')::int <> 2 then raise exception 'own: %', t->'own'; end if;
  if (t->'own'->>'chats')::int - (ta->'own'->>'chats')::int <> 1 then raise exception 'own chats: %', t->'own'; end if;
  if (x->'own'->>'today_messages')::int - (xa->'own'->>'today_messages')::int <> 2 then raise exception 'own x: %', x->'own'; end if;
  if not (t->'own'->'providers') @> '[{"provider":"openai"}]' or (t->'own'->'providers') @> '[{"provider":"gemini"}]' then raise exception 'own providers: %', t->'own'; end if;
  -- łącznik
  if (t->'mcp'->>'today_calls')::int - (ta->'mcp'->>'today_calls')::int <> 4 then raise exception 'mcp: %', t->'mcp'; end if;
  if (t->'mcp'->>'errors_30d')::int - (ta->'mcp'->>'errors_30d')::int <> 1 then raise exception 'mcp errors: %', t->'mcp'; end if;
  if (x->'mcp'->>'today_calls')::int - (xa->'mcp'->>'today_calls')::int <> 1 then raise exception 'mcp x: %', x->'mcp'; end if;
  if not (t->'mcp'->'tools') @> '[{"tool":"unknown"}]' then raise exception 'mcp unknown tool: %', t->'mcp'; end if;
  if not (t->'mcp'->'apps') @> '[{"name":"API","kind":"api_key"}]' or (t->'mcp'->'apps')::text like '%Moje prywatne%' then raise exception 'mcp apps: %', t->'mcp'->'apps'; end if;
  if (t->'mcp'->>'api_keys_never')::int - (ta->'mcp'->>'api_keys_never')::int <> 1 then raise exception 'api never: %', t->'mcp'; end if;
  -- zużycie dzienne
  select u into d from jsonb_array_elements(r->'usage') u where (u->>'day')::date = public._ai_today();
  if (d->>'messages')::int <> (ta->>'today_messages')::int + 3 or (d->>'excluded_messages')::int <> (xa->>'today_messages')::int + 18
     or (d->>'own_messages')::int <> (ta->'own'->>'today_messages')::int + 2
     or (d->>'mcp_calls')::int <> (ta->'mcp'->>'today_calls')::int + 4 or (d->>'excluded_mcp_calls')::int <> (xa->'mcp'->>'today_calls')::int + 1
  then raise exception 'usage: %', d; end if;
end $$;

-- usunięcie wszystkich rozmów: tylko własne
set local role authenticated;
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000545a1', true);
  r := public.ai_chat_delete_all();
  if (r->>'deleted')::int <> 2 then raise exception 'delete_all: %', r; end if;
  if jsonb_array_length(public.ai_chat_list()->'chats') <> 0 then raise exception 'delete_all: zostały rozmowy'; end if;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000545c3', true);
  if jsonb_array_length(public.ai_chat_list()->'chats') <> 1 then raise exception 'delete_all: usunięte cudze'; end if;
end $$;
reset role;

set local role authenticated;
do $$
begin
  perform public.admin_ai_limits_get();
  raise exception 'authenticated: admin_ai_limits_get dostępne';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform public.mcp_usage_record('00000000-0000-4000-8000-00000545f001', 'x', true);
  raise exception 'authenticated: mcp_usage_record dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'ai-usage-split-545: OK' as wynik;
rollback;
