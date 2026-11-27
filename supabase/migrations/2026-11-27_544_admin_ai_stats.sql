-- E30: panel admina, zakładka „Czat AI” — podsumowanie użycia obok ustawień.
-- admin_ai_limits_get zwraca dodatkowo „totals” (liczby, bez treści):
-- dziś i 30 dni (osoby, wiadomości, kroki asystenta Familijnej), zapisane
-- rozmowy i ich właściciele, sejfy kluczy, połączone aplikacje MCP, klucze API.
-- Zgodna wstecz (nowe pole). Tylko service_role (Worker panelu admina).
CREATE OR REPLACE FUNCTION public.admin_ai_limits_get()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT jsonb_build_object(
    'limits', (SELECT to_jsonb(l) - 'id' FROM public.ai_limits l WHERE id = 1),
    'usage', coalesce((SELECT jsonb_agg(jsonb_build_object('day', d.day, 'users', d.users, 'messages', d.messages, 'steps', d.steps) ORDER BY d.day DESC)
      FROM (SELECT day, count(*) AS users, sum(messages) AS messages, sum(steps) AS steps
              FROM public.ai_usage WHERE day > public._ai_today() - 14 GROUP BY day) d), '[]'::jsonb),
    'totals', jsonb_build_object(
      'today_users', (SELECT count(*) FROM public.ai_usage WHERE day = public._ai_today()),
      'today_messages', (SELECT coalesce(sum(messages), 0) FROM public.ai_usage WHERE day = public._ai_today()),
      'today_steps', (SELECT coalesce(sum(steps), 0) FROM public.ai_usage WHERE day = public._ai_today()),
      'users_30d', (SELECT count(DISTINCT user_id) FROM public.ai_usage WHERE day > public._ai_today() - 30),
      'messages_30d', (SELECT coalesce(sum(messages), 0) FROM public.ai_usage WHERE day > public._ai_today() - 30),
      'chats', (SELECT count(*) FROM public.ai_chats),
      'chat_users', (SELECT count(DISTINCT user_id) FROM public.ai_chats),
      'chats_7d', (SELECT count(*) FROM public.ai_chats WHERE updated_at > now() - interval '7 days'),
      'vaults', (SELECT count(*) FROM public.ai_key_vaults),
      'mcp_apps', (SELECT count(*) FROM public.mcp_tokens WHERE kind = 'oauth' AND revoked_at IS NULL AND expires_at > now()),
      'mcp_users', (SELECT count(DISTINCT user_id) FROM public.mcp_tokens WHERE kind = 'oauth' AND revoked_at IS NULL AND expires_at > now()),
      'api_keys', (SELECT count(*) FROM public.mcp_tokens WHERE kind = 'api_key' AND revoked_at IS NULL)
    )
  )
$$;
REVOKE ALL ON FUNCTION public.admin_ai_limits_get() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_ai_limits_get() TO service_role;
