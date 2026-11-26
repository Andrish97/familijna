-- Migracja 536: sejf kluczy AI. Uruchomienie: lokalna baza wg
-- docs/sql/local-db.md (schema.sql + migracje od 514 + 535 + 536), potem:
-- psql ... -d fam -f tests/sql/ai-key-vault-536.sql
\set ON_ERROR_STOP 1
begin;
-- od migracji 538 czat widzą tylko konta wg ai_limits.chat_audience — tu wszyscy
do $$ begin
  if to_regclass('public.ai_limits') is not null then update public.ai_limits set chat_audience = 'all' where id = 1; end if;
end $$;
insert into auth.users(id,email,email_confirmed_at) values
  ('53600000-0000-4000-8000-0000000000aa','a536@x.pl',now()),
  ('53600000-0000-4000-8000-0000000000bb','b536@x.pl',now()),
  ('53600000-0000-4000-8000-0000000000cc',null,null);
insert into public.profiles(id, username, is_guest) values
  ('53600000-0000-4000-8000-0000000000aa','a536',false),
  ('53600000-0000-4000-8000-0000000000bb','b536',false),
  ('53600000-0000-4000-8000-0000000000cc','g536',true)
on conflict (id) do update set is_guest = excluded.is_guest;
set local role authenticated;

do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '53600000-0000-4000-8000-0000000000aa', true);
  if public.ai_vault_get()->'vault' <> 'null'::jsonb then raise exception 'pusty sejf: %', public.ai_vault_get(); end if;
  r := public.ai_vault_save('c2FsdHNhbHRzYWx0c2FsdA==', '{"iv":"a","ct":"b"}', '{"iv":"c","ct":"d"}');
  if not (r->>'ok')::boolean then raise exception 'save: %', r; end if;
  r := public.ai_vault_save('c2FsdHNhbHRzYWx0c2FsdA==', '{"iv":"a","ct":"b"}', '{"iv":"e","ct":"f"}');
  if public.ai_vault_get()->'vault'->'payload'->>'ct' <> 'f' then raise exception 'update'; end if;
  if public.ai_vault_save('short', '{"iv":"a","ct":"b"}', '{"iv":"c","ct":"d"}')->>'error' <> 'invalid_payload' then raise exception 'sól'; end if;
  if public.ai_vault_save('c2FsdHNhbHRzYWx0c2FsdA==', '{"x":1}', '{"iv":"c","ct":"d"}')->>'error' <> 'invalid_payload' then raise exception 'check'; end if;

  -- inny użytkownik ma własny (pusty) sejf
  perform set_config('request.jwt.claim.sub', '53600000-0000-4000-8000-0000000000bb', true);
  if public.ai_vault_get()->'vault' <> 'null'::jsonb then raise exception 'cudzy sejf widoczny'; end if;
  if (public.ai_vault_delete()->>'deleted')::boolean then raise exception 'cudzy sejf usunięty'; end if;

  -- gość: brak
  perform set_config('request.jwt.claim.sub', '53600000-0000-4000-8000-0000000000cc', true);
  if public.ai_vault_get()->>'error' <> 'registered_account_required' then raise exception 'gość'; end if;

  perform set_config('request.jwt.claim.sub', '53600000-0000-4000-8000-0000000000aa', true);
  if not (public.ai_vault_delete()->>'deleted')::boolean then raise exception 'delete'; end if;
end $$;

do $$
begin
  perform 1 from public.ai_key_vaults;
  raise exception 'authenticated: tabela dostępna';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'ai-key-vault-536: OK' as wynik;
rollback;
