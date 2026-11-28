-- 547: diagnoza statystyk czatu AI (pytanie właściciela 2026-11-28: łącznie
-- 33 wiadomości przed podziałem 545, 10 po). Dla roli agent_reader (414) tylko
-- liczby na dzień: wiadomości asystenta Familijnej wszystkich kont, zwykłych,
-- kont testowych i wykluczonych ręcznie, oraz liczby osób. Bez treści i nazw.
CREATE OR REPLACE FUNCTION public.agent_ai_usage_check()
RETURNS TABLE (day date, messages_all bigint, messages_regular bigint, messages_test bigint, messages_manual bigint,
               users_all bigint, users_regular bigint, users_test bigint, users_manual bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT a.day,
         sum(a.messages),
         coalesce(sum(a.messages) FILTER (WHERE e.user_id IS NULL), 0),
         coalesce(sum(a.messages) FILTER (WHERE e.reason <> 'manual'), 0),
         coalesce(sum(a.messages) FILTER (WHERE e.reason = 'manual'), 0),
         count(*),
         count(*) FILTER (WHERE e.user_id IS NULL),
         count(*) FILTER (WHERE e.reason <> 'manual'),
         count(*) FILTER (WHERE e.reason = 'manual')
    FROM public.ai_usage a
    LEFT JOIN public.stats_exclusions_effective e ON e.user_id = a.user_id
   WHERE a.day > public._ai_today() - 30
   GROUP BY a.day
   ORDER BY a.day DESC
$$;
REVOKE ALL ON FUNCTION public.agent_ai_usage_check() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    GRANT EXECUTE ON FUNCTION public.agent_ai_usage_check() TO agent_reader;
  END IF;
END $$;
