-- Migracja 538: limity wbudowanego czatu (ai_quota_take, ai_quota_status,
-- admin_ai_limits_*). Lokalna baza wg docs/sql/local-db.md + migracje do 538:
-- psql ... -d fam -f tests/sql/ai-quota-538.sql
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id,email,email_confirmed_at) values
  ('53800000-0000-4000-8000-0000000000aa','a538@x.pl',now()),
  ('53800000-0000-4000-8000-0000000000cc',null,null),
  ('53800000-0000-4000-8000-0000000000dd','t538@x.pl',now());
insert into public.profiles(id, username, is_guest) values
  ('53800000-0000-4000-8000-0000000000aa','a538',false),
  ('53800000-0000-4000-8000-0000000000cc','g538',true),
  ('53800000-0000-4000-8000-0000000000dd','e2e.standard99',false)
on conflict (id) do update set is_guest = excluded.is_guest;
-- konto testowe (E25): rola e2e w app_metadata — is_test_user
update auth.users set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"e2e_role": "standard"}'
 where id = '53800000-0000-4000-8000-0000000000dd';

do $$
declare r jsonb; a uuid := '53800000-0000-4000-8000-0000000000aa'; g uuid := '53800000-0000-4000-8000-0000000000cc';
begin
  -- domyślnie: czat tylko dla kont testowych, klucz Familijnej wyłączony
  if public._ai_visible(a) then raise exception 'zwykłe konto widzi czat przed udostępnieniem'; end if;
  if not public._ai_visible('53800000-0000-4000-8000-0000000000dd') then raise exception 'konto testowe nie widzi czatu'; end if;
  r := public.ai_quota_take('53800000-0000-4000-8000-0000000000dd', true);
  if r->>'error' <> 'disabled' then raise exception 'klucz Familijnej domyślnie wyłączony: %', r; end if;
  -- klucz Familijnej tylko dla kont testowych: zwykłe konto dalej bez niego
  perform public.admin_ai_limits_set('{"builtin_audience": "test"}');
  if public.ai_quota_take(a, true)->>'error' <> 'disabled' then raise exception 'test-only: zwykłe konto'; end if;
  if not public.is_test_user('53800000-0000-4000-8000-0000000000dd') then raise exception 'konto e2e. nie jest testowe?'; end if;
  r := public.ai_quota_take('53800000-0000-4000-8000-0000000000dd', true);
  if r->>'error' = 'disabled' then raise exception 'test-only: konto testowe bez dostępu: %', r; end if;
  r := public.admin_ai_limits_set('{"chat_audience": "all", "builtin_audience": "all", "daily_messages": 2, "per_minute": 5, "max_steps": 2}');
  if r->'limits'->>'builtin_audience' <> 'all' or (r->'limits'->>'daily_messages')::int <> 2 then raise exception 'set: %', r; end if;
  if not public._ai_visible(a) then raise exception 'po udostępnieniu zwykłe konto widzi czat'; end if;
  begin
    perform public.admin_ai_limits_set('{"chat_audience": "everyone"}');
    raise exception 'audience check';
  exception when check_violation then null;
  end;

  -- gość nie korzysta
  if public.ai_quota_take(g, true)->>'error' <> 'not_registered' then raise exception 'gość'; end if;

  -- wiadomość 1 + kroki do limitu kroków
  r := public.ai_quota_take(a, true);
  if not (r->>'ok')::boolean or (r->>'remaining')::int <> 1 or r->>'model' not like 'gemini-%-flash-lite' then raise exception 'msg1: %', r; end if;
  r := public.ai_quota_take(a, false);
  if not (r->>'ok')::boolean then raise exception 'step2: %', r; end if;
  r := public.ai_quota_take(a, false);
  if r->>'error' <> 'step_limit' then raise exception 'step_limit: %', r; end if;
  -- wiadomość 2 zeruje kroki; trzecia — limit dzienny
  if not (public.ai_quota_take(a, true)->>'ok')::boolean then raise exception 'msg2'; end if;
  r := public.ai_quota_take(a, true);
  if r->>'error' <> 'daily_limit' or (r->>'used')::int <> 2 or r->>'reset_at' is null then raise exception 'daily: %', r; end if;

  -- limit na minutę
  perform public.admin_ai_limits_set('{"daily_messages": 100, "per_minute": 2}');
  r := public.ai_quota_take(a, true);
  if r->>'error' <> 'minute_limit' then raise exception 'minute: %', r; end if;

  -- bezpiecznik całego serwisu
  perform public.admin_ai_limits_set('{"per_minute": 100, "global_daily_messages": 2}');
  if public.ai_quota_take(a, true)->>'error' <> 'global_limit' then raise exception 'global'; end if;

  r := public.admin_ai_limits_get();
  if (r->'usage'->0->>'messages')::int <> 3 or (r->'usage'->0->>'users')::int <> 2 then raise exception 'usage: %', r; end if;
  begin
    perform public.admin_ai_limits_set('{"daily_messages": -1}');
    raise exception 'check';
  exception when check_violation then null;
  end;
end $$;

-- stan dla użytkownika (authenticated) i brak dostępu do funkcji serwera
set local role authenticated;
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '53800000-0000-4000-8000-0000000000aa', true);
  r := public.ai_quota_status();
  if not (r->>'visible')::boolean or not (r->>'enabled')::boolean or (r->>'used')::int <> 2 then raise exception 'status: %', r; end if;
  begin
    perform public.ai_quota_take('53800000-0000-4000-8000-0000000000aa', true);
    raise exception 'authenticated nie może wołać ai_quota_take';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_ai_limits_set('{"chat_audience": "off"}');
    raise exception 'authenticated nie może zmieniać limitów';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- czat ukryty dla zwykłych kont: historia rozmów (535) też niedostępna
update public.ai_limits set chat_audience = 'test' where id = 1;
set local role authenticated;
do $$
declare r jsonb;
begin
  perform set_config('request.jwt.claim.sub', '53800000-0000-4000-8000-0000000000aa', true);
  r := public.ai_quota_status();
  if (r->>'visible')::boolean then raise exception 'ukryty: %', r; end if;
  r := public.ai_chat_save(null, 'x', 'familijna', 'm', '[]');
  if (r->>'ok')::boolean then raise exception 'historia dla ukrytego czatu: %', r; end if;
end $$;
rollback;
\echo ai-quota-538 OK
