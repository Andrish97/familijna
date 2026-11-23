-- 536 (E30): sejf kluczy AI na koncie (decyzje 1 i 8). Klucze szyfruje
-- przeglądarka hasłem do kluczy (PBKDF2-SHA256 + AES-GCM, wzór: Makietka);
-- baza ma tylko szyfrogram — bez hasła nie odczyta go nikt, także
-- administrator. Jeden wiersz na konto, tylko konta zarejestrowane.
--   salt     — sól PBKDF2 (base64)
--   check    — zaszyfrowany stały tekst do sprawdzenia hasła {iv, ct}
--   payload  — zaszyfrowana lista kluczy i wybór aktywnego {iv, ct}
-- Dostęp tylko przez endpointy ai_vault_get / ai_vault_save / ai_vault_delete.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_key_vaults (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  salt text NOT NULL CHECK (char_length(salt) BETWEEN 16 AND 64),
  "check" jsonb NOT NULL CHECK (jsonb_typeof("check") = 'object'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pg_column_size(payload) <= 65536)
);
ALTER TABLE public.ai_key_vaults ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_key_vaults FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ai_vault_get() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  v public.ai_key_vaults;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  select * into v from public.ai_key_vaults where user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', true, 'vault', null);
  end if;
  return jsonb_build_object('ok', true, 'vault',
    jsonb_build_object('salt', v.salt, 'check', v."check", 'payload', v.payload, 'updated_at', v.updated_at));
end;
$$;
REVOKE ALL ON FUNCTION public.ai_vault_get() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_vault_get() TO authenticated;

-- Zapis całego sejfu. Zmiana soli (nowe hasło) dozwolona tylko razem z nowym
-- check. Szyfrogram jest dla bazy nieczytelny — sprawdzamy tylko kształt.
CREATE OR REPLACE FUNCTION public.ai_vault_save(p_salt text, p_check jsonb, p_payload jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  if coalesce(char_length(p_salt), 0) not between 16 and 64
     or jsonb_typeof(p_check) is distinct from 'object' or not (p_check ? 'iv' and p_check ? 'ct')
     or jsonb_typeof(p_payload) is distinct from 'object' or not (p_payload ? 'iv' and p_payload ? 'ct') then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if pg_column_size(p_payload) > 65536 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  insert into public.ai_key_vaults (user_id, salt, "check", payload, updated_at)
  values (v_uid, p_salt, p_check, p_payload, now())
  on conflict (user_id) do update
    set salt = excluded.salt, "check" = excluded."check", payload = excluded.payload, updated_at = now();
  return jsonb_build_object('ok', true);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_vault_save(text, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_vault_save(text, jsonb, jsonb) TO authenticated;

-- Usunięcie sejfu (zapomniane hasło — klucze trzeba dodać od nowa).
CREATE OR REPLACE FUNCTION public.ai_vault_delete() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  delete from public.ai_key_vaults where user_id = v_uid;
  return jsonb_build_object('ok', true, 'deleted', found);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_vault_delete() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_vault_delete() TO authenticated;

COMMIT;
