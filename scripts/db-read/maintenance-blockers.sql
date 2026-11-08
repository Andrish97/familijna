-- Czy przerwa techniczna coś przerwie (liczby). Te same źródła i okna co
-- panel admina (get_maintenance_activity), z pominięciem kont wyłączonych
-- ze statystyk (testy, admin). Każda kolumna blokada_* > 0 blokuje „on”.
-- Zamek edycji i strony edycji liczą się tylko przy karcie widocznej (visible)
-- w ostatnich 90 s — otwarta w tle karta nie blokuje godzinami, głosy tylko
-- w grach kont spoza testów (E24, 2026-11-08).
WITH ex AS (SELECT user_id FROM public.stats_exclusions_effective),
pages AS (
  SELECT * FROM public.site_activity a
  WHERE a.last_seen_at > now() - interval '90 seconds' AND a.user_id NOT IN (SELECT user_id FROM ex)
), locks AS (
  SELECT * FROM public.edit_locks l
  WHERE l.heartbeat_at > now() - interval '25 seconds' AND l.holder_user_id NOT IN (SELECT user_id FROM ex)
), seen AS (
  SELECT DISTINCT user_id FROM pages WHERE visible
), control AS (
  SELECT game_id FROM public.device_presence WHERE last_seen_at > now() - interval '25 seconds'
  UNION SELECT game_id FROM pages WHERE game_id IS NOT NULL AND page IN ('control', 'control2')
  UNION SELECT game_id FROM public.game_sessions
    WHERE control_version = 2 AND ended_at IS NULL AND status IN ('started', 'playing', 'final') AND last_seen_at > now() - interval '15 minutes'
  UNION SELECT resource_id FROM locks WHERE resource_type = 'game' AND holder_context = 'control'
  UNION SELECT game_id FROM public.control_runtime_sessions WHERE ended_at IS NULL AND expires_at > now()
)
SELECT
  (SELECT count(DISTINCT user_id) FROM pages) AS uzytkownicy_90s,
  (SELECT count(*) FROM control c JOIN public.games g ON g.id = c.game_id
    WHERE g.owner_id NOT IN (SELECT user_id FROM ex)) AS blokada_control,
  (SELECT count(*) FROM locks WHERE coalesce(holder_context, '') <> 'control'
    AND holder_user_id IN (SELECT user_id FROM seen)) AS blokada_edycja,
  (SELECT count(DISTINCT user_id) FROM pages
    WHERE visible AND page IN ('editor', 'game-settings', 'game-settings2', 'base-explorer', 'logo-editor', 'polls')) AS blokada_strony_edycji,
  (SELECT count(*) FROM public.poll_votes v JOIN public.games g ON g.id = v.game_id
    WHERE v.created_at > now() - interval '10 minutes' AND g.owner_id NOT IN (SELECT user_id FROM ex))
   + (SELECT count(*) FROM public.poll_text_entries e JOIN public.games g ON g.id = e.game_id
    WHERE e.created_at > now() - interval '10 minutes' AND g.owner_id NOT IN (SELECT user_id FROM ex)) AS blokada_glosy_10min,
  now() AS teraz
