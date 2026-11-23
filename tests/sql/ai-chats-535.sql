-- Migracja 535: historia rozmów czatu AI. Uruchomienie: lokalna baza wg
-- docs/sql/local-db.md (schema.sql + migracje od 514 + 535), potem:
-- psql ... -d fam -f tests/sql/ai-chats-535.sql
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id,email,email_confirmed_at) values
  ('53500000-0000-4000-8000-0000000000aa','a535@x.pl',now()),
  ('53500000-0000-4000-8000-0000000000bb','b535@x.pl',now()),
  ('53500000-0000-4000-8000-0000000000cc',null,null);
insert into public.profiles(id, username, is_guest) values
  ('53500000-0000-4000-8000-0000000000aa','a535',false),
  ('53500000-0000-4000-8000-0000000000bb','b535',false),
  ('53500000-0000-4000-8000-0000000000cc','g535',true)
on conflict (id) do update set is_guest = excluded.is_guest;
set local role authenticated;

do $$
declare r jsonb; id1 uuid;
begin
  perform set_config('request.jwt.claim.sub', '53500000-0000-4000-8000-0000000000aa', true);
  r := public.ai_chat_save(null, '  Pierwsza rozmowa  ', 'anthropic', 'claude-sonnet-5-5', '[{"role":"user","content":"Cześć"}]');
  if not (r->>'ok')::boolean then raise exception 'save: %', r; end if;
  id1 := (r->>'id')::uuid;
  r := public.ai_chat_save(id1, 'Pierwsza', 'anthropic', 'm', '[{"role":"user","content":"a"},{"role":"assistant","content":"b"}]');
  if not (r->>'ok')::boolean then raise exception 'update: %', r; end if;
  r := public.ai_chat_get(id1);
  if jsonb_array_length(r->'history') <> 2 or r->>'title' <> 'Pierwsza' then raise exception 'get: %', r; end if;
  r := public.ai_chat_list();
  if jsonb_array_length(r->'chats') <> 1 or (r->'chats'->0) ? 'history' then raise exception 'list: %', r; end if;
  r := public.ai_chat_save(null, 'x', 'BAD!', 'm', '[]');
  if r->>'error' <> 'invalid_payload' then raise exception 'provider: %', r; end if;
  r := public.ai_chat_save(null, 'x', 'openai', 'm', '{}');
  if r->>'error' <> 'invalid_payload' then raise exception 'history object: %', r; end if;

  -- inny użytkownik nie widzi, nie zmienia i nie usuwa
  perform set_config('request.jwt.claim.sub', '53500000-0000-4000-8000-0000000000bb', true);
  if public.ai_chat_get(id1)->>'error' <> 'not_found' then raise exception 'cudza: get'; end if;
  if public.ai_chat_save(id1, 'hack', 'openai', 'm', '[]')->>'error' <> 'not_found' then raise exception 'cudza: save'; end if;
  if (public.ai_chat_delete(id1)->>'deleted')::boolean then raise exception 'cudza: delete'; end if;
  if jsonb_array_length(public.ai_chat_list()->'chats') <> 0 then raise exception 'cudza: list'; end if;

  -- gość: brak czatu
  perform set_config('request.jwt.claim.sub', '53500000-0000-4000-8000-0000000000cc', true);
  if public.ai_chat_list()->>'error' <> 'registered_account_required' then raise exception 'gość: list'; end if;
  if public.ai_chat_save(null, 'x', 'openai', 'm', '[]')->>'error' <> 'registered_account_required' then raise exception 'gość: save'; end if;

  -- właściciel usuwa
  perform set_config('request.jwt.claim.sub', '53500000-0000-4000-8000-0000000000aa', true);
  if not (public.ai_chat_delete(id1)->>'deleted')::boolean then raise exception 'delete'; end if;
end $$;

-- bez bezpośredniego dostępu do tabeli
do $$
begin
  perform 1 from public.ai_chats;
  raise exception 'authenticated: tabela dostępna';
exception when insufficient_privilege then null;
end $$;

-- sprzątanie: starsze niż 30 dni znikają
reset role;
insert into public.ai_chats(user_id, provider, updated_at) values
  ('53500000-0000-4000-8000-0000000000aa', 'openai', now() - interval '31 days'),
  ('53500000-0000-4000-8000-0000000000aa', 'openai', now() - interval '29 days');
do $$
begin
  if public.ai_chats_cleanup() <> 1 then raise exception 'cleanup'; end if;
  if (select count(*) from public.ai_chats where user_id = '53500000-0000-4000-8000-0000000000aa') <> 1 then raise exception 'cleanup: zostaje 29 dni'; end if;
end $$;
select 'ai-chats-535: OK' as wynik;
rollback;
