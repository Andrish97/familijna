-- E30: statystyki czatu AI w panelu admina, rozdzielone na trzy źródła:
--   asystent Familijnej (ai_usage, rozmowy z provider = 'familijna'),
--   własne klucze (nowy dzienny licznik ai_own_usage, rozmowy innych dostawców, sejfy),
--   łącznik MCP i klucze API (nowy dzienny licznik mcp_usage, połączenia).
-- Konta testowe i wykluczone (stats_exclusions_effective, jak pozostałe
-- statystyki) zawsze osobno: totals / totals_excluded, w zużyciu dziennym x_*.
-- Liczniki: tylko liczby i nazwy (dostawca, aplikacja, narzędzie), bez treści;
-- klucze API pod wspólną nazwą „API” (nazwy kluczy wpisuje użytkownik).
-- Zgodna wstecz: klucze z 544 zostają (chats* liczą teraz rozmowy asystenta).

-- 1. Liczniki dzienne --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_own_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  provider text NOT NULL CHECK (provider ~ '^[a-z]{2,20}$'),
  messages integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, provider)
);
CREATE INDEX IF NOT EXISTS ai_own_usage_day_idx ON public.ai_own_usage (day);
ALTER TABLE public.ai_own_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_own_usage FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.mcp_usage (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL CHECK (kind IN ('oauth', 'api_key')),
  client_name text NOT NULL CHECK (char_length(client_name) <= 100),
  tool text NOT NULL CHECK (tool ~ '^[a-z0-9_]{1,64}$'),
  calls integer NOT NULL DEFAULT 0,
  errors integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day, kind, client_name, tool)
);
CREATE INDEX IF NOT EXISTS mcp_usage_day_idx ON public.mcp_usage (day);
ALTER TABLE public.mcp_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mcp_usage FROM PUBLIC, anon, authenticated;

-- 2. Wiadomości użytkownika w historii (formaty Gemini, OpenAI, Anthropic):
--    role = user z tekstem — bez wyników narzędzi (functionResponse, tool_result).
CREATE OR REPLACE FUNCTION public._ai_user_messages(p_history jsonb)
RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  SELECT count(*)::integer
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_history) = 'array' THEN p_history ELSE '[]'::jsonb END) m
   WHERE m->>'role' = 'user'
     AND (jsonb_typeof(m->'content') = 'string'
          OR (jsonb_typeof(m->'parts') = 'array'
              AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(m->'parts') p WHERE p ? 'functionResponse')))
$$;
REVOKE ALL ON FUNCTION public._ai_user_messages(jsonb) FROM PUBLIC, anon, authenticated;

-- 3. Zapis rozmowy liczy przyrost wiadomości własnego klucza (jak w 535 + licznik).
CREATE OR REPLACE FUNCTION public.ai_chat_save(p_id uuid, p_title text, p_provider text, p_model text, p_history jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  v_id uuid;
  v_before integer := 0;
  v_added integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  if jsonb_typeof(p_history) is distinct from 'array' or coalesce(p_provider, '') !~ '^[a-z]{2,20}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if pg_column_size(p_history) > 2 * 1024 * 1024 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  if p_id is null then
    insert into public.ai_chats (user_id, title, provider, model, history)
    values (v_uid, left(btrim(coalesce(p_title, '')), 120), p_provider, left(coalesce(p_model, ''), 120), p_history)
    returning id into v_id;
  else
    select public._ai_user_messages(history) into v_before
      from public.ai_chats where id = p_id and user_id = v_uid for update;
    update public.ai_chats
       set title = left(btrim(coalesce(p_title, '')), 120), provider = p_provider,
           model = left(coalesce(p_model, ''), 120), history = p_history, updated_at = now()
     where id = p_id and user_id = v_uid
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;
  -- asystent Familijnej liczy się w ai_usage (serwer), tu tylko własne klucze
  v_added := least(greatest(public._ai_user_messages(p_history) - coalesce(v_before, 0), 0), 50);
  if p_provider <> 'familijna' and v_added > 0 then
    insert into public.ai_own_usage (user_id, day, provider, messages)
    values (v_uid, public._ai_today(), p_provider, v_added)
    on conflict (user_id, day, provider) do update set messages = public.ai_own_usage.messages + excluded.messages;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_save(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_save(uuid, text, text, text, jsonb) TO authenticated;

-- 4. Wywołanie narzędzia przez łącznik MCP / API (funkcja Edge mcp, klucz serwisowy).
CREATE OR REPLACE FUNCTION public.mcp_usage_record(p_token_id uuid, p_tool text, p_ok boolean)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  INSERT INTO public.mcp_usage (user_id, day, kind, client_name, tool, calls, errors)
  SELECT t.user_id, public._ai_today(), t.kind,
         CASE WHEN t.kind = 'api_key' THEN 'API' ELSE left(t.client_name, 100) END,
         CASE WHEN p_tool ~ '^[a-z0-9_]{1,64}$' THEN p_tool ELSE 'unknown' END,
         1, CASE WHEN p_ok THEN 0 ELSE 1 END
    FROM public.mcp_tokens t WHERE t.id = p_token_id
  ON CONFLICT (user_id, day, kind, client_name, tool)
  DO UPDATE SET calls = public.mcp_usage.calls + 1, errors = public.mcp_usage.errors + excluded.errors
$$;
REVOKE ALL ON FUNCTION public.mcp_usage_record(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_usage_record(uuid, text, boolean) TO service_role;

-- 5. Podsumowanie dla jednej grupy kont (p_excluded: testowe i wykluczone).
CREATE OR REPLACE FUNCTION public._admin_ai_totals(p_excluded boolean)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ex AS (SELECT user_id FROM public.stats_exclusions_effective),
  u AS (SELECT * FROM public.ai_usage a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  c AS (SELECT * FROM public.ai_chats a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  bc AS (SELECT * FROM c WHERE provider = 'familijna'),
  oc AS (SELECT * FROM c WHERE provider <> 'familijna'),
  ou AS (SELECT * FROM public.ai_own_usage a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  v AS (SELECT * FROM public.ai_key_vaults a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  t AS (SELECT * FROM public.mcp_tokens a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded AND revoked_at IS NULL
          AND (kind = 'api_key' OR expires_at > now())),
  mu AS (SELECT * FROM public.mcp_usage a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded
          AND day > public._ai_today() - 30)
  SELECT jsonb_build_object(
    -- asystent Familijnej (klucze z 544)
    'today_users', (SELECT count(*) FROM u WHERE day = public._ai_today()),
    'today_messages', (SELECT coalesce(sum(messages), 0) FROM u WHERE day = public._ai_today()),
    'today_steps', (SELECT coalesce(sum(steps), 0) FROM u WHERE day = public._ai_today()),
    'users_30d', (SELECT count(DISTINCT user_id) FROM u WHERE day > public._ai_today() - 30),
    'messages_30d', (SELECT coalesce(sum(messages), 0) FROM u WHERE day > public._ai_today() - 30),
    'chats', (SELECT count(*) FROM bc),
    'chat_users', (SELECT count(DISTINCT user_id) FROM bc),
    'chats_7d', (SELECT count(*) FROM bc WHERE updated_at > now() - interval '7 days'),
    'vaults', (SELECT count(*) FROM v),
    'mcp_apps', (SELECT count(*) FROM t WHERE kind = 'oauth'),
    'mcp_users', (SELECT count(DISTINCT user_id) FROM t WHERE kind = 'oauth'),
    'api_keys', (SELECT count(*) FROM t WHERE kind = 'api_key'),
    -- własne klucze
    'own', jsonb_build_object(
      'vaults', (SELECT count(*) FROM v),
      'today_messages', (SELECT coalesce(sum(messages), 0) FROM ou WHERE day = public._ai_today()),
      'today_users', (SELECT count(DISTINCT user_id) FROM ou WHERE day = public._ai_today()),
      'messages_30d', (SELECT coalesce(sum(messages), 0) FROM ou WHERE day > public._ai_today() - 30),
      'users_30d', (SELECT count(DISTINCT user_id) FROM ou WHERE day > public._ai_today() - 30),
      'chats', (SELECT count(*) FROM oc),
      'chat_users', (SELECT count(DISTINCT user_id) FROM oc),
      'chats_7d', (SELECT count(*) FROM oc WHERE updated_at > now() - interval '7 days'),
      'providers', coalesce((SELECT jsonb_agg(jsonb_build_object('provider', provider, 'messages_30d', m, 'users_30d', n) ORDER BY m DESC, provider)
         FROM (SELECT provider, sum(messages) AS m, count(DISTINCT user_id) AS n FROM ou
                WHERE day > public._ai_today() - 30 GROUP BY provider) x), '[]'::jsonb)),
    -- łącznik MCP i klucze API
    'mcp', jsonb_build_object(
      'today_calls', (SELECT coalesce(sum(calls), 0) FROM mu WHERE day = public._ai_today()),
      'today_users', (SELECT count(DISTINCT user_id) FROM mu WHERE day = public._ai_today()),
      'calls_30d', (SELECT coalesce(sum(calls), 0) FROM mu),
      'errors_30d', (SELECT coalesce(sum(errors), 0) FROM mu),
      'users_30d', (SELECT count(DISTINCT user_id) FROM mu),
      'connections', (SELECT count(*) FROM t WHERE kind = 'oauth'),
      'active_24h', (SELECT count(*) FROM t WHERE kind = 'oauth' AND last_used_at > now() - interval '24 hours'),
      'active_7d', (SELECT count(*) FROM t WHERE kind = 'oauth' AND last_used_at > now() - interval '7 days'),
      'api_keys', (SELECT count(*) FROM t WHERE kind = 'api_key'),
      'api_keys_used_7d', (SELECT count(*) FROM t WHERE kind = 'api_key' AND last_used_at > now() - interval '7 days'),
      'api_keys_never', (SELECT count(*) FROM t WHERE kind = 'api_key' AND last_used_at IS NULL),
      'apps', coalesce((SELECT jsonb_agg(jsonb_build_object('name', client_name, 'kind', kind, 'connections', k, 'users', n, 'last_used', lu, 'calls_30d', cl) ORDER BY cl DESC, k DESC, client_name)
         FROM (SELECT g.client_name, g.kind, count(*) FILTER (WHERE g.tok) AS k, count(DISTINCT g.user_id) AS n,
                      max(g.last_used_at) AS lu, coalesce(sum(g.calls), 0) AS cl
                 FROM (SELECT CASE WHEN kind = 'api_key' THEN 'API' ELSE client_name END AS client_name, kind, user_id, last_used_at, true AS tok, 0 AS calls FROM t
                       UNION ALL
                       SELECT client_name, kind, user_id, NULL, false, calls FROM mu) g
                GROUP BY g.client_name, g.kind) x), '[]'::jsonb),
      'tools', coalesce((SELECT jsonb_agg(jsonb_build_object('tool', tool, 'calls', cl, 'errors', er, 'users', n) ORDER BY cl DESC, tool)
         FROM (SELECT tool, sum(calls) AS cl, sum(errors) AS er, count(DISTINCT user_id) AS n FROM mu GROUP BY tool) x), '[]'::jsonb))
  )
$$;
REVOKE ALL ON FUNCTION public._admin_ai_totals(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_ai_totals(boolean) TO service_role;

-- 6. Wynik dla panelu: ustawienia, zużycie dzienne (14 dni) i podsumowania.
CREATE OR REPLACE FUNCTION public.admin_ai_limits_get()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ex AS (SELECT user_id FROM public.stats_exclusions_effective),
  days AS (SELECT (public._ai_today() - g)::date AS day FROM generate_series(0, 13) g),
  b AS (SELECT a.day, (a.user_id IN (SELECT user_id FROM ex)) AS x, count(*) AS users, sum(a.messages) AS messages, sum(a.steps) AS steps
          FROM public.ai_usage a WHERE a.day > public._ai_today() - 14 GROUP BY 1, 2),
  o AS (SELECT a.day, (a.user_id IN (SELECT user_id FROM ex)) AS x, count(DISTINCT a.user_id) AS users, sum(a.messages) AS messages
          FROM public.ai_own_usage a WHERE a.day > public._ai_today() - 14 GROUP BY 1, 2),
  m AS (SELECT a.day, (a.user_id IN (SELECT user_id FROM ex)) AS x, count(DISTINCT a.user_id) AS users, sum(a.calls) AS calls, sum(a.errors) AS errors
          FROM public.mcp_usage a WHERE a.day > public._ai_today() - 14 GROUP BY 1, 2),
  r14 AS (
    SELECT d.day,
      coalesce(b0.users, 0) AS users, coalesce(b0.messages, 0) AS messages, coalesce(b0.steps, 0) AS steps,
      coalesce(b1.users, 0) AS excluded_users, coalesce(b1.messages, 0) AS excluded_messages, coalesce(b1.steps, 0) AS excluded_steps,
      coalesce(o0.users, 0) AS own_users, coalesce(o0.messages, 0) AS own_messages,
      coalesce(o1.users, 0) AS excluded_own_users, coalesce(o1.messages, 0) AS excluded_own_messages,
      coalesce(m0.users, 0) AS mcp_users, coalesce(m0.calls, 0) AS mcp_calls, coalesce(m0.errors, 0) AS mcp_errors,
      coalesce(m1.users, 0) AS excluded_mcp_users, coalesce(m1.calls, 0) AS excluded_mcp_calls
    FROM days d
    LEFT JOIN b b0 ON b0.day = d.day AND NOT b0.x LEFT JOIN b b1 ON b1.day = d.day AND b1.x
    LEFT JOIN o o0 ON o0.day = d.day AND NOT o0.x LEFT JOIN o o1 ON o1.day = d.day AND o1.x
    LEFT JOIN m m0 ON m0.day = d.day AND NOT m0.x LEFT JOIN m m1 ON m1.day = d.day AND m1.x)
  SELECT jsonb_build_object(
    'limits', (SELECT to_jsonb(l) - 'id' FROM public.ai_limits l WHERE id = 1),
    'usage', coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.day DESC) FROM r14 r
      WHERE r.users + r.excluded_users + r.own_messages + r.excluded_own_messages + r.mcp_calls + r.excluded_mcp_calls > 0), '[]'::jsonb),
    'totals', public._admin_ai_totals(false),
    'totals_excluded', public._admin_ai_totals(true)
  )
$$;
REVOKE ALL ON FUNCTION public.admin_ai_limits_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_limits_get() TO service_role;

-- 7. Usunięcie wszystkich rozmów konta (okno czatu → Rozmowy → Usuń wszystkie).
CREATE OR REPLACE FUNCTION public.ai_chat_delete_all() RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  v_n integer;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  delete from public.ai_chats where user_id = v_uid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_n);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_delete_all() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_delete_all() TO authenticated;
