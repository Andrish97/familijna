-- 537 (E30, decyzja 19): logowanie OAuth 2.1 dla serwera MCP Familijnej
-- (Claude, ChatGPT i inne klienty MCP — wzór: Makietka). Przepływ:
--   klient rejestruje się (DCR) → /authorize (PKCE S256) → strona zgody
--   Familijnej (konto zarejestrowane) → kod (5 min) → /token → token dostępu.
-- W bazie tylko skróty SHA-256 kodów i tokenów. Token ważny 90 dni albo do
-- odwołania w Ustawieniach konta. Funkcja Edge `mcp` zamienia token na
-- użytkownika (mcp_token_user, tylko service_role) i woła narzędzia jego
-- krótkotrwałym JWT — te same endpointy i RLS co strona.

BEGIN;

CREATE TABLE IF NOT EXISTS public.mcp_clients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  redirect_uris text[] NOT NULL CHECK (cardinality(redirect_uris) BETWEEN 1 AND 5),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.mcp_auth_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.mcp_clients(id) ON DELETE CASCADE,
  redirect_uri text NOT NULL,
  code_challenge text NOT NULL CHECK (code_challenge ~ '^[A-Za-z0-9_-]{43,128}$'),
  state text CHECK (char_length(state) <= 500),
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  code_hash text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS public.mcp_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.mcp_clients(id) ON DELETE SET NULL,
  client_name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS mcp_tokens_user_idx ON public.mcp_tokens (user_id);
ALTER TABLE public.mcp_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_auth_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_clients, public.mcp_auth_requests, public.mcp_tokens FROM PUBLIC, anon, authenticated;

-- SHA-256 tekstu (hex) i PKCE S256 (base64url bez '=').
CREATE OR REPLACE FUNCTION public._mcp_hash(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$ select encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'hex') $$;
REVOKE ALL ON FUNCTION public._mcp_hash(text) FROM PUBLIC, anon, authenticated;
CREATE OR REPLACE FUNCTION public._mcp_s256(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select translate(rtrim(encode(sha256(convert_to(coalesce(p, ''), 'UTF8')), 'base64'), '='), '+/', '-_')
$$;
REVOKE ALL ON FUNCTION public._mcp_s256(text) FROM PUBLIC, anon, authenticated;
-- Losowy sekret (2 × uuid v4 = 244 bity losowości), bez pgcrypto.
CREATE OR REPLACE FUNCTION public._mcp_secret() RETURNS text
LANGUAGE sql VOLATILE SET search_path TO 'public' AS $$
  select replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
$$;
REVOKE ALL ON FUNCTION public._mcp_secret() FROM PUBLIC, anon, authenticated;

-- Adres powrotu klienta: https albo http://localhost / 127.0.0.1 (aplikacje na komputerze).
CREATE OR REPLACE FUNCTION public._mcp_redirect_ok(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select char_length(coalesce(p, '')) <= 500
     and (p ~ '^https://[^/?#\s]+(/[^#\s]*)?$' or p ~ '^http://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?(/[^#\s]*)?$')
$$;
REVOKE ALL ON FUNCTION public._mcp_redirect_ok(text) FROM PUBLIC, anon, authenticated;

-- Rejestracja klienta (DCR, RFC 7591) — woła funkcja Edge bez logowania.
CREATE OR REPLACE FUNCTION public.mcp_client_register(p_name text, p_redirect_uris text[]) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_id uuid;
  v_name text := left(btrim(coalesce(p_name, '')), 100);
  u text;
begin
  if v_name = '' then v_name := 'MCP'; end if;
  if p_redirect_uris is null or cardinality(p_redirect_uris) not between 1 and 5 then
    return jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri');
  end if;
  foreach u in array p_redirect_uris loop
    if not public._mcp_redirect_ok(u) then
      return jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri');
    end if;
  end loop;
  insert into public.mcp_clients (name, redirect_uris) values (v_name, p_redirect_uris) returning id into v_id;
  return jsonb_build_object('ok', true, 'client_id', v_id, 'client_name', v_name);
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_client_register(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_client_register(text, text[]) TO anon, authenticated;

-- Początek autoryzacji: prośba czeka na decyzję użytkownika (15 min).
CREATE OR REPLACE FUNCTION public.mcp_authorize_begin(p_client uuid, p_redirect_uri text, p_challenge text, p_state text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  c public.mcp_clients;
  v_id uuid;
begin
  select * into c from public.mcp_clients where id = p_client;
  if not found then return jsonb_build_object('ok', false, 'error', 'invalid_client'); end if;
  if not (p_redirect_uri = any (c.redirect_uris)) then return jsonb_build_object('ok', false, 'error', 'invalid_redirect_uri'); end if;
  if coalesce(p_challenge, '') !~ '^[A-Za-z0-9_-]{43,128}$' then return jsonb_build_object('ok', false, 'error', 'invalid_request'); end if;
  insert into public.mcp_auth_requests (client_id, redirect_uri, code_challenge, state)
  values (c.id, p_redirect_uri, p_challenge, left(p_state, 500)) returning id into v_id;
  return jsonb_build_object('ok', true, 'request_id', v_id);
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_authorize_begin(uuid, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_authorize_begin(uuid, text, text, text) TO anon, authenticated;

-- Strona zgody: nazwa klienta i adres, na który wróci (konto zarejestrowane).
CREATE OR REPLACE FUNCTION public.mcp_authorize_info(p_request uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  r record;
begin
  if public._ai_chat_uid() is null then return jsonb_build_object('ok', false, 'error', 'registered_account_required'); end if;
  select q.id, q.redirect_uri, q.decided_at, q.created_at, c.name into r
    from public.mcp_auth_requests q join public.mcp_clients c on c.id = q.client_id where q.id = p_request;
  if not found or r.decided_at is not null or r.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  return jsonb_build_object('ok', true, 'client_name', r.name,
    'redirect_host', substring(r.redirect_uri from '^[a-z]+://([^/?#]+)'));
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_authorize_info(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_authorize_info(uuid) TO authenticated;

-- Decyzja użytkownika: adres powrotu z kodem (zgoda) albo z błędem (odmowa).
CREATE OR REPLACE FUNCTION public.mcp_authorize_decide(p_request uuid, p_allow boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  q public.mcp_auth_requests;
  v_code text;
  v_sep text;
  v_state text;
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'registered_account_required'); end if;
  select * into q from public.mcp_auth_requests where id = p_request for update;
  if not found or q.decided_at is not null or q.created_at < now() - interval '15 minutes' then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  v_sep := case when position('?' in q.redirect_uri) > 0 then '&' else '?' end;
  v_state := case when q.state is null then '' else '&state=' || replace(replace(replace(q.state, '%', '%25'), '&', '%26'), '#', '%23') end;
  if not coalesce(p_allow, false) then
    update public.mcp_auth_requests set decided_at = now() where id = q.id;
    return jsonb_build_object('ok', true, 'redirect', q.redirect_uri || v_sep || 'error=access_denied' || v_state);
  end if;
  v_code := public._mcp_secret();
  update public.mcp_auth_requests set decided_at = now(), user_id = v_uid, code_hash = public._mcp_hash(v_code) where id = q.id;
  return jsonb_build_object('ok', true, 'redirect', q.redirect_uri || v_sep || 'code=' || v_code || v_state);
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_authorize_decide(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_authorize_decide(uuid, boolean) TO authenticated;

-- Wymiana kodu na token (jednorazowo, 5 min, PKCE). Token wraca tylko tu.
CREATE OR REPLACE FUNCTION public.mcp_token_exchange(p_code text, p_verifier text, p_client uuid, p_redirect_uri text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  q public.mcp_auth_requests;
  v_token text;
  v_name text;
begin
  select * into q from public.mcp_auth_requests where code_hash = public._mcp_hash(p_code) for update;
  if not found or q.used_at is not null or q.decided_at < now() - interval '5 minutes'
     or q.client_id is distinct from p_client or q.redirect_uri is distinct from p_redirect_uri
     or q.user_id is null or public._mcp_s256(p_verifier) <> q.code_challenge then
    return jsonb_build_object('ok', false, 'error', 'invalid_grant');
  end if;
  update public.mcp_auth_requests set used_at = now() where id = q.id;
  select name into v_name from public.mcp_clients where id = q.client_id;
  update public.mcp_clients set last_used_at = now() where id = q.client_id;
  v_token := 'fam_mcp_' || public._mcp_secret();
  insert into public.mcp_tokens (user_id, client_id, client_name, token_hash, expires_at)
  values (q.user_id, q.client_id, coalesce(v_name, 'MCP'), public._mcp_hash(v_token), now() + interval '90 days');
  return jsonb_build_object('ok', true, 'access_token', v_token, 'token_type', 'Bearer', 'expires_in', 90 * 24 * 3600);
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_token_exchange(text, text, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_token_exchange(text, text, uuid, text) TO anon, authenticated;

-- Token → użytkownik (tylko funkcja Edge, klucz serwisowy). Konto musi być
-- nadal zarejestrowane (nie gość, nie usunięte).
CREATE OR REPLACE FUNCTION public.mcp_token_user(p_token text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp' AS $$
declare
  t public.mcp_tokens;
  v_identity jsonb;
begin
  select * into t from public.mcp_tokens where token_hash = public._mcp_hash(p_token);
  if not found or t.revoked_at is not null or t.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  select to_jsonb(u) into v_identity from auth.users u where u.id = t.user_id;
  if not public._account_is_registered(t.user_id, v_identity) then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if t.last_used_at is null or t.last_used_at < now() - interval '5 minutes' then
    update public.mcp_tokens set last_used_at = now() where id = t.id;
  end if;
  return jsonb_build_object('ok', true, 'user_id', t.user_id, 'token_id', t.id, 'email', v_identity->>'email');
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_token_user(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_token_user(text) TO service_role;

-- Ustawienia konta: połączone aplikacje i odwołanie dostępu.
CREATE OR REPLACE FUNCTION public.mcp_tokens_mine() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'registered_account_required'); end if;
  return jsonb_build_object('ok', true, 'tokens', coalesce((
    select jsonb_agg(jsonb_build_object('id', t.id, 'client_name', t.client_name, 'created_at', t.created_at,
                                        'last_used_at', t.last_used_at, 'expires_at', t.expires_at) order by t.created_at desc)
      from public.mcp_tokens t
     where t.user_id = v_uid and t.revoked_at is null and t.expires_at > now()), '[]'::jsonb));
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_tokens_mine() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_tokens_mine() TO authenticated;

CREATE OR REPLACE FUNCTION public.mcp_token_revoke(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'registered_account_required'); end if;
  update public.mcp_tokens set revoked_at = now() where id = p_id and user_id = v_uid and revoked_at is null;
  return jsonb_build_object('ok', true, 'revoked', found);
end;
$$;
REVOKE ALL ON FUNCTION public.mcp_token_revoke(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mcp_token_revoke(uuid) TO authenticated;

-- Sprzątanie: prośby starsze niż dzień, tokeny wygasłe/odwołane po 30 dniach,
-- klienci bez tokenów i bez użycia od 30 dni.
CREATE OR REPLACE FUNCTION public.mcp_cleanup() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  delete from public.mcp_auth_requests where created_at < now() - interval '1 day';
  delete from public.mcp_tokens where coalesce(revoked_at, expires_at) < now() - interval '30 days';
  delete from public.mcp_clients c where coalesce(c.last_used_at, c.created_at) < now() - interval '30 days'
    and not exists (select 1 from public.mcp_tokens t where t.client_id = c.id);
$$;
REVOKE ALL ON FUNCTION public.mcp_cleanup() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_job bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = ''familijna_mcp_cleanup'' LIMIT 1' INTO v_job;
    IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
    PERFORM cron.schedule('familijna_mcp_cleanup', '41 3 * * *', 'SELECT public.mcp_cleanup()');
  END IF;
END $$;

COMMIT;
