-- E30 (decyzje 25–30): wbudowany czat na kluczu Familijnej (Gemini 2.5
-- Flash-Lite, tylko płatny klucz). Limity na użytkownika: dziennie (20),
-- na minutę (6), kroki narzędzi na wiadomość (8) i dzienny bezpiecznik całego
-- serwisu. Liczy funkcja Edge ai-chat (service_role) przez ai_quota_take;
-- użytkownik widzi swój stan przez ai_quota_status; panel admina zmienia
-- ustawienia przez admin_ai_limits_get/set. Doba w strefie Europe/Warsaw.
-- Dostępność (audience): off — wyłączony; test — tylko konta testowe
-- (is_test_user: próba na produkcji z prawdziwym Gemini przed udostępnieniem);
-- all — wszystkie konta zarejestrowane.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_limits (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  audience text NOT NULL DEFAULT 'off' CHECK (audience IN ('off', 'test', 'all')),
  model text NOT NULL DEFAULT 'gemini-2.5-flash-lite',
  daily_messages integer NOT NULL DEFAULT 20 CHECK (daily_messages BETWEEN 0 AND 1000),
  per_minute integer NOT NULL DEFAULT 6 CHECK (per_minute BETWEEN 1 AND 120),
  max_steps integer NOT NULL DEFAULT 8 CHECK (max_steps BETWEEN 1 AND 40),
  global_daily_messages integer NOT NULL DEFAULT 5000 CHECK (global_daily_messages BETWEEN 0 AND 1000000),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO public.ai_limits (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.ai_limits ENABLE ROW LEVEL SECURITY;

-- Wiadomości i kroki na dzień; zdarzenia z ostatnich minut — do limitu na minutę.
CREATE TABLE IF NOT EXISTS public.ai_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  messages integer NOT NULL DEFAULT 0,
  steps integer NOT NULL DEFAULT 0,
  steps_in_message integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_usage_day_idx ON public.ai_usage (day);

CREATE TABLE IF NOT EXISTS public.ai_usage_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS ai_usage_events_user_at_idx ON public.ai_usage_events (user_id, at);

CREATE OR REPLACE FUNCTION public._ai_today() RETURNS date
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT (clock_timestamp() AT TIME ZONE 'Europe/Warsaw')::date
$$;
REVOKE ALL ON FUNCTION public._ai_today() FROM PUBLIC, anon, authenticated;

-- Początek następnej doby (Europe/Warsaw) — kiedy limit dzienny wraca.
CREATE OR REPLACE FUNCTION public._ai_reset_at() RETURNS timestamptz
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT ((public._ai_today() + 1)::timestamp AT TIME ZONE 'Europe/Warsaw')
$$;
REVOKE ALL ON FUNCTION public._ai_reset_at() FROM PUBLIC, anon, authenticated;

/**
 * Sprawdza i zalicza jedno zapytanie do modelu. p_new_message = nowa wiadomość
 * użytkownika (liczy się do limitu dziennego i na minutę); false = kolejny krok
 * narzędzi tej samej wiadomości (limit kroków). Tylko konto zarejestrowane.
 * Wynik: { ok, model, remaining, daily, reset_at } albo { ok: false, error:
 * disabled | not_registered | daily_limit | minute_limit | step_limit | global_limit, … }.
 */
CREATE OR REPLACE FUNCTION public.ai_quota_take(p_user uuid, p_new_message boolean)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp' AS $$
declare
  l public.ai_limits;
  v_identity jsonb;
  v_day date := public._ai_today();
  u public.ai_usage;
  v_recent integer;
  v_global integer;
begin
  select * into l from public.ai_limits where id = 1;
  if not found or l.audience = 'off' or (l.audience = 'test' and not public.is_test_user(p_user)) then
    return jsonb_build_object('ok', false, 'error', 'disabled');
  end if;
  select to_jsonb(x) into v_identity from auth.users x where x.id = p_user;
  if v_identity is null or not public._account_is_registered(p_user, v_identity) then
    return jsonb_build_object('ok', false, 'error', 'not_registered');
  end if;

  -- jeden wiersz na użytkownika i dzień, zablokowany do końca transakcji
  insert into public.ai_usage (user_id, day) values (p_user, v_day) on conflict do nothing;
  select * into u from public.ai_usage where user_id = p_user and day = v_day for update;

  if p_new_message then
    if u.messages >= l.daily_messages then
      return jsonb_build_object('ok', false, 'error', 'daily_limit', 'daily', l.daily_messages, 'used', u.messages, 'reset_at', public._ai_reset_at());
    end if;
    select count(*) into v_recent from public.ai_usage_events
     where user_id = p_user and at > clock_timestamp() - interval '1 minute';
    if v_recent >= l.per_minute then
      return jsonb_build_object('ok', false, 'error', 'minute_limit', 'per_minute', l.per_minute);
    end if;
    select coalesce(sum(messages), 0) into v_global from public.ai_usage where day = v_day;
    if v_global >= l.global_daily_messages then
      return jsonb_build_object('ok', false, 'error', 'global_limit');
    end if;
    update public.ai_usage set messages = messages + 1, steps = steps + 1, steps_in_message = 1
     where user_id = p_user and day = v_day returning * into u;
    insert into public.ai_usage_events (user_id) values (p_user);
  else
    if u.messages = 0 then
      -- krok bez wiadomości tego dnia (np. dokończenie po północy) liczy się jak wiadomość
      return public.ai_quota_take(p_user, true);
    end if;
    if u.steps_in_message >= l.max_steps then
      return jsonb_build_object('ok', false, 'error', 'step_limit', 'max_steps', l.max_steps);
    end if;
    update public.ai_usage set steps = steps + 1, steps_in_message = steps_in_message + 1
     where user_id = p_user and day = v_day returning * into u;
  end if;

  return jsonb_build_object('ok', true, 'model', l.model, 'daily', l.daily_messages,
    'remaining', greatest(l.daily_messages - u.messages, 0), 'reset_at', public._ai_reset_at());
end;
$$;
REVOKE ALL ON FUNCTION public.ai_quota_take(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_quota_take(uuid, boolean) TO service_role;

-- Stan dla użytkownika: czy asystent Familijnej działa i ile zostało dziś.
CREATE OR REPLACE FUNCTION public.ai_quota_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp' AS $$
declare
  l public.ai_limits;
  v_uid uuid := public._ai_chat_uid();
  v_used integer;
begin
  select * into l from public.ai_limits where id = 1;
  if v_uid is null then return jsonb_build_object('ok', false, 'error', 'not_registered'); end if;
  select messages into v_used from public.ai_usage where user_id = v_uid and day = public._ai_today();
  return jsonb_build_object('ok', true,
    'enabled', l.audience = 'all' or (l.audience = 'test' and public.is_test_user(v_uid)),
    'daily', l.daily_messages,
    'used', coalesce(v_used, 0), 'remaining', greatest(l.daily_messages - coalesce(v_used, 0), 0),
    'reset_at', public._ai_reset_at());
end;
$$;
REVOKE ALL ON FUNCTION public.ai_quota_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_quota_status() TO authenticated;

-- Panel admina (service_role): ustawienia i zużycie z ostatnich dni.
CREATE OR REPLACE FUNCTION public.admin_ai_limits_get()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'limits', (SELECT to_jsonb(l) - 'id' FROM public.ai_limits l WHERE id = 1),
    'usage', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'messages', d.messages, 'steps', d.steps) ORDER BY d.day DESC)
      FROM (SELECT day, count(*) AS users, sum(messages) AS messages, sum(steps) AS steps
              FROM public.ai_usage WHERE day > public._ai_today() - 14 GROUP BY day) d), '[]'::jsonb)
  )
$$;
REVOKE ALL ON FUNCTION public.admin_ai_limits_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_limits_get() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_limits_set(p_patch jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
begin
  update public.ai_limits set
    audience = coalesce(nullif(btrim(p_patch->>'audience'), ''), audience),
    model = coalesce(nullif(btrim(p_patch->>'model'), ''), model),
    daily_messages = coalesce((p_patch->>'daily_messages')::integer, daily_messages),
    per_minute = coalesce((p_patch->>'per_minute')::integer, per_minute),
    max_steps = coalesce((p_patch->>'max_steps')::integer, max_steps),
    global_daily_messages = coalesce((p_patch->>'global_daily_messages')::integer, global_daily_messages),
    updated_at = now()
  where id = 1;
  return public.admin_ai_limits_get();
end;
$$;
REVOKE ALL ON FUNCTION public.admin_ai_limits_set(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_limits_set(jsonb) TO service_role;

-- Sprzątanie: zdarzenia starsze niż doba, liczniki starsze niż 60 dni.
CREATE OR REPLACE FUNCTION public.ai_usage_cleanup() RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  DELETE FROM public.ai_usage_events WHERE at < clock_timestamp() - interval '1 day';
  DELETE FROM public.ai_usage WHERE day < public._ai_today() - 60;
$$;
REVOKE ALL ON FUNCTION public.ai_usage_cleanup() FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('familijna_ai_usage_cleanup', '47 3 * * *', 'SELECT public.ai_usage_cleanup()');
  END IF;
END $$;

COMMIT;
