-- E30: statystyki czatu AI w panelu admina — konta testowe i wykluczone osobno
-- (jak pozostałe statystyki: widok stats_exclusions_effective — konta e2e,
-- goście testowi, wykluczenia ręczne).
--   totals          — bez kont testowych i wykluczonych (te same klucze co w 544),
--   totals_excluded — te same liczby tylko dla kont testowych i wykluczonych,
--   usage[]         — users/messages/steps bez nich, excluded_* osobno.
-- Zgodna wstecz (te same klucze, nowe pola). Tylko service_role.
CREATE OR REPLACE FUNCTION public._admin_ai_totals(p_excluded boolean)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  WITH ex AS (SELECT user_id FROM public.stats_exclusions_effective),
  u AS (SELECT * FROM public.ai_usage a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  c AS (SELECT * FROM public.ai_chats a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  v AS (SELECT * FROM public.ai_key_vaults a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded),
  t AS (SELECT * FROM public.mcp_tokens a WHERE (a.user_id IN (SELECT user_id FROM ex)) = p_excluded)
  SELECT jsonb_build_object(
    'today_users', (SELECT count(*) FROM u WHERE day = public._ai_today()),
    'today_messages', (SELECT coalesce(sum(messages), 0) FROM u WHERE day = public._ai_today()),
    'today_steps', (SELECT coalesce(sum(steps), 0) FROM u WHERE day = public._ai_today()),
    'users_30d', (SELECT count(DISTINCT user_id) FROM u WHERE day > public._ai_today() - 30),
    'messages_30d', (SELECT coalesce(sum(messages), 0) FROM u WHERE day > public._ai_today() - 30),
    'chats', (SELECT count(*) FROM c),
    'chat_users', (SELECT count(DISTINCT user_id) FROM c),
    'chats_7d', (SELECT count(*) FROM c WHERE updated_at > now() - interval '7 days'),
    'vaults', (SELECT count(*) FROM v),
    'mcp_apps', (SELECT count(*) FROM t WHERE kind = 'oauth' AND revoked_at IS NULL AND expires_at > now()),
    'mcp_users', (SELECT count(DISTINCT user_id) FROM t WHERE kind = 'oauth' AND revoked_at IS NULL AND expires_at > now()),
    'api_keys', (SELECT count(*) FROM t WHERE kind = 'api_key' AND revoked_at IS NULL)
  )
$$;
REVOKE ALL ON FUNCTION public._admin_ai_totals(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._admin_ai_totals(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_ai_limits_get()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'limits', (SELECT to_jsonb(l) - 'id' FROM public.ai_limits l WHERE id = 1),
    'usage', coalesce((SELECT jsonb_agg(jsonb_build_object(
        'day', d.day, 'users', d.users, 'messages', d.messages, 'steps', d.steps,
        'excluded_users', d.x_users, 'excluded_messages', d.x_messages, 'excluded_steps', d.x_steps) ORDER BY d.day DESC)
      FROM (SELECT a.day,
                   count(*) FILTER (WHERE e.user_id IS NULL) AS users,
                   coalesce(sum(a.messages) FILTER (WHERE e.user_id IS NULL), 0) AS messages,
                   coalesce(sum(a.steps) FILTER (WHERE e.user_id IS NULL), 0) AS steps,
                   count(*) FILTER (WHERE e.user_id IS NOT NULL) AS x_users,
                   coalesce(sum(a.messages) FILTER (WHERE e.user_id IS NOT NULL), 0) AS x_messages,
                   coalesce(sum(a.steps) FILTER (WHERE e.user_id IS NOT NULL), 0) AS x_steps
              FROM public.ai_usage a
              LEFT JOIN public.stats_exclusions_effective e ON e.user_id = a.user_id
             WHERE a.day > public._ai_today() - 14 GROUP BY a.day) d), '[]'::jsonb),
    'totals', public._admin_ai_totals(false),
    'totals_excluded', public._admin_ai_totals(true)
  )
$$;
REVOKE ALL ON FUNCTION public.admin_ai_limits_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_limits_get() TO service_role;
