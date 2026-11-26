-- Migracja 538: limity wbudowanego czatu (ai_quota_take, ai_quota_status,
-- admin_ai_limits_*). Lokalna baza wg docs/sql/local-db.md + migracje do 538:
-- psql ... -d fam -f tests/sql/ai-quota-538.sql
\set ON_ERROR_STOP 1
begin;
insert into auth.users(id,email,email_confirmed_at) values
  ('53800000-0000-4000-8000-0000000000aa','a538@x.pl',now()),
  ('53800000-0000-4000-8000-0000000000cc',null,null);
insert into public.profiles(id, username, is_guest) values
  ('53800000-0000-4000-8000-0000000000aa','a538',false),
  ('53800000-0000-4000-8000-0000000000cc','g538',true)
on conflict (id) do update set is_guest = excluded.is_guest;

do $$
declare r jsonb; a uuid := '53800000-0000-4000-8000-0000000000aa'; g uuid := '53800000-0000-4000-8000-0000000000cc';
begin
  -- domyślnie wyłączone
  r := public.ai_quota_take(a, true);
  if r->>'error' <> 'disabled' then raise exception 'disabled: %', r; end if;
  r := public.admin_ai_limits_set('{"enabled": true, "daily_messages": 2, "per_minute": 5, "max_steps": 2}');
  if not (r->'limits'->>'enabled')::boolean or (r->'limits'->>'daily_messages')::int <> 2 then raise exception 'set: %', r; end if;

  -- gość nie korzysta
  if public.ai_quota_take(g, true)->>'error' <> 'not_registered' then raise exception 'gość'; end if;

  -- wiadomość 1 + kroki do limitu kroków
  r := public.ai_quota_take(a, true);
  if not (r->>'ok')::boolean or (r->>'remaining')::int <> 1 or r->>'model' <> 'gemini-2.5-flash-lite' then raise exception 'msg1: %', r; end if;
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
  if (r->'usage'->0->>'messages')::int <> 2 then raise exception 'usage: %', r; end if;
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
  if not (r->>'enabled')::boolean or (r->>'used')::int <> 2 then raise exception 'status: %', r; end if;
  begin
    perform public.ai_quota_take('53800000-0000-4000-8000-0000000000aa', true);
    raise exception 'authenticated nie może wołać ai_quota_take';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.admin_ai_limits_set('{"enabled": false}');
    raise exception 'authenticated nie może zmieniać limitów';
  exception when insufficient_privilege then null;
  end;
end $$;
rollback;
\echo ai-quota-538 OK
