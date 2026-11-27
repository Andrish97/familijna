-- E30 (decyzja 35): osobiste klucze API Familijnej — zewnętrzne czaty i programy
-- korzystają z Familijnej bez logowania OAuth: łącznik MCP (nagłówek
-- Authorization: Bearer fam_key_…) albo zwykłe API HTTP (/mcp/api, OpenAPI).
-- Te same tokeny co łącznik (mcp_tokens, tylko skrót SHA-256), rodzaj api_key,
-- bez wygasania; widoczne raz przy utworzeniu, odwołanie: mcp_token_revoke.
-- Zakres jak użytkownik (bez zawężania — decyzja 35). Migracja dodająca.

BEGIN;

ALTER TABLE public.mcp_tokens ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'oauth';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mcp_tokens_kind_check') THEN
    ALTER TABLE public.mcp_tokens ADD CONSTRAINT mcp_tokens_kind_check CHECK (kind IN ('oauth', 'api_key'));
  END IF;
END $$;

-- Nowy klucz: nazwa 1–60 znaków, najwyżej 10 aktywnych kluczy i 10 nowych na godzinę.
CREATE OR REPLACE FUNCTION public.mcp_api_key_create(p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_token text;
  v_id uuid;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'registered_account_required'); end if;
  if char_length(v_name) = 0 or char_length(v_name) > 60 then return jsonb_build_object('ok', false, 'error', 'invalid_name'); end if;
  if (select count(*) from public.mcp_tokens where user_id = v_uid and kind = 'api_key' and revoked_at is null) >= 10 then
    return jsonb_build_object('ok', false, 'error', 'too_many_keys');
  end if;
  if (select count(*) from public.mcp_tokens where user_id = v_uid and kind = 'api_key' and created_at > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'rate_limited');
  end if;
  v_token := 'fam_key_' || public._mcp_secret();
  insert into public.mcp_tokens (user_id, client_id, client_name, token_hash, expires_at, kind)
  values (v_uid, null, v_name, public._mcp_hash(v_token), 'infinity', 'api_key')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'token', v_token, 'name', v_name);
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_api_key_create(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_api_key_create(text) TO authenticated;

-- Ustawienia konta: połączone aplikacje i klucze API (rodzaj w polu kind).
CREATE OR REPLACE FUNCTION public.mcp_tokens_mine() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'registered_account_required'); end if;
  return jsonb_build_object('ok', true, 'tokens', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'client_name', t.client_name, 'created_at', t.created_at,
                                        'last_used_at', t.last_used_at,
                                        'expires_at', case when t.expires_at = 'infinity' then null else t.expires_at end,
                                        'kind', t.kind) order by t.created_at desc)
      from public.mcp_tokens t
     where t.user_id = v_uid and t.revoked_at is null and t.expires_at > now()), '[]'::jsonb));
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_tokens_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_tokens_mine() TO authenticated;

COMMIT;
