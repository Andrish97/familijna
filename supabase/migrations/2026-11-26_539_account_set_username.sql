-- E30 (spis czynności, rozdział 5): zmiana nazwy użytkownika jako endpoint —
-- ta sama reguła dla strony Ustawień konta i czatu AI (decyzja 12). Dotąd
-- strona zapisywała wprost do profiles + auth.updateUser i sama rezerwowała
-- limit. Tu w jednej transakcji: format i zarezerwowane nazwy (jak
-- validateUsername i reserved_username_reason), zajętość (bez względu na
-- wielkość liter), limit raz na godzinę (cooldown_reserve 'account:username'),
-- zapis profilu i nazwy w metadanych konta. Tylko konto zarejestrowane.
-- Wynik: { ok, username } albo { ok: false, error: not_registered | invalid |
-- reserved | taken | cooldown, next_allowed_at? }.

BEGIN;

CREATE OR REPLACE FUNCTION public.account_set_username(p_username text)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp' AS $$
declare
  v_uid uuid := auth.uid();
  v_identity jsonb;
  v_name text := btrim(coalesce(p_username, ''));
  v_old text;
  r record;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_registered'); end if;
  select to_jsonb(u) into v_identity from auth.users u where u.id = v_uid;
  if not public._account_is_registered(v_uid, v_identity) then
    return jsonb_build_object('ok', false, 'error', 'not_registered');
  end if;
  if v_name !~ '^[a-zA-Z0-9_.-]{3,20}$' or lower(v_name) like 'guest\_%' then
    return jsonb_build_object('ok', false, 'error', 'invalid');
  end if;
  if public.reserved_username_reason(v_name) is not null then
    return jsonb_build_object('ok', false, 'error', 'reserved');
  end if;
  select username into v_old from public.profiles where id = v_uid for update;
  if v_old = v_name then return jsonb_build_object('ok', true, 'username', v_name, 'unchanged', true); end if;
  if exists (select 1 from public.profiles where lower(username) = lower(v_name) and id <> v_uid) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;
  select * into r from public.cooldown_reserve('account:username', 3600);
  if not r.ok then
    return jsonb_build_object('ok', false, 'error', 'cooldown', 'next_allowed_at', r.next_allowed_at);
  end if;
  update public.profiles set username = v_name where id = v_uid;
  update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('username', v_name)
   where id = v_uid;
  return jsonb_build_object('ok', true, 'username', v_name);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'taken');
end;
$$;
REVOKE ALL ON FUNCTION public.account_set_username(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.account_set_username(text) TO authenticated;

COMMIT;
