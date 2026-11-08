-- Wykluczenia ze statystyk wykluczają wszystko (decyzja użytkownika 2026-11-08):
-- konto testowe albo wykluczone ręcznie w panelu admina nie liczy się
-- w statystykach, ocenach systemu ani ocenach i dodaniach gier Społeczności.
--  1. get_admin_stats: oceny systemu i ankiety (sesje, głosy) bez wykluczonych
--     (dotąd liczone wszystkie).
--  2. get_stats_detail('ratings'): lista ocen bez wykluczonych.
--  3. Oceny gier Społeczności (avg_rating, rating_count) i library_count bez
--     wszystkich wykluczonych (dotąd tylko konta testowe, library_count wszystkie);
--     przeliczane przy zmianie wykluczeń ręcznych i raz teraz.
--  4. Ocena systemu wygasłego gościa zostaje tylko, gdy nie był wykluczony.
-- Zgodna wstecz: te same sygnatury i kształt wyników.

CREATE OR REPLACE FUNCTION "public"."get_admin_stats"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  result       jsonb;
  excluded_ids uuid[];

  total_users      bigint;
  confirmed_users  bigint;
  guest_users      bigint;
  users_new_today  bigint;
  users_new_7d     bigint;
  users_new_30d    bigint;
  users_pl bigint; users_en bigint; users_uk bigint;

  total_games      bigint;
  games_ready      bigint;
  games_new_today  bigint;
  games_new_7d     bigint;
  games_new_30d    bigint;
  avg_questions    numeric;
  custom_settings_total bigint;

  played_today    bigint;
  played_7d       bigint;
  played_30d      bigint;
  finished_30d    bigint;
  abandoned_30d   bigint;
  in_progress     bigint;
  errors_30d      bigint;
  legacy_total    bigint;

  poll_sessions_7d  bigint;
  poll_votes_7d     bigint;
  poll_votes_total  bigint;

  bases_total    bigint;
  bases_new_today bigint;
  bases_new_7d   bigint;
  bases_new_30d  bigint;

  logos_total    bigint;
  logos_new_today bigint;
  logos_new_7d   bigint;
  logos_new_30d  bigint;

  mail_errors_24h  bigint;

  total_ratings    bigint;
  avg_rating       numeric;
  ratings_new_today bigint;
  ratings_new_7d   bigint;
  ratings_new_30d  bigint;
BEGIN
  SELECT ARRAY(SELECT user_id FROM public.stats_exclusions_effective) INTO excluded_ids;

  -- Users
  SELECT COUNT(*) INTO total_users     FROM public.profiles WHERE NOT (id = ANY(excluded_ids));
  SELECT COUNT(*) INTO confirmed_users FROM public.profiles WHERE is_guest = false AND NOT (id = ANY(excluded_ids));
  SELECT COUNT(*) INTO guest_users     FROM public.profiles WHERE is_guest = true  AND NOT (id = ANY(excluded_ids));
  SELECT COUNT(*) INTO users_new_today FROM public.profiles WHERE created_at >= CURRENT_DATE                AND NOT (id = ANY(excluded_ids));
  SELECT COUNT(*) INTO users_new_7d    FROM public.profiles WHERE created_at >= now() - interval '7 days'  AND NOT (id = ANY(excluded_ids));
  SELECT COUNT(*) INTO users_new_30d   FROM public.profiles WHERE created_at >= now() - interval '30 days' AND NOT (id = ANY(excluded_ids));

  SELECT COUNT(*) INTO users_pl FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.raw_user_meta_data->>'language') = 'pl' AND NOT (u.id = ANY(excluded_ids));
  SELECT COUNT(*) INTO users_en FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.raw_user_meta_data->>'language') = 'en' AND NOT (u.id = ANY(excluded_ids));
  SELECT COUNT(*) INTO users_uk FROM auth.users u
    JOIN public.profiles p ON p.id = u.id
    WHERE lower(u.raw_user_meta_data->>'language') = 'uk' AND NOT (u.id = ANY(excluded_ids));

  -- Games
  SELECT COUNT(*) INTO total_games      FROM public.games WHERE is_demo = false AND source_market_id IS NULL AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO games_ready      FROM public.games WHERE is_demo = false AND source_market_id IS NULL AND status = 'ready' AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO games_new_today  FROM public.games WHERE is_demo = false AND source_market_id IS NULL AND created_at >= CURRENT_DATE AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO games_new_7d     FROM public.games WHERE is_demo = false AND source_market_id IS NULL AND created_at >= now() - interval '7 days' AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO games_new_30d    FROM public.games WHERE is_demo = false AND source_market_id IS NULL AND created_at >= now() - interval '30 days' AND NOT (owner_id = ANY(excluded_ids));
  SELECT COALESCE(ROUND(AVG(q_count), 1), 0) INTO avg_questions
    FROM (SELECT COUNT(*) AS q_count FROM public.questions q
          JOIN public.games g ON g.id = q.game_id
          WHERE g.is_demo = false AND g.source_market_id IS NULL AND NOT (g.owner_id = ANY(excluded_ids))
          GROUP BY q.game_id) AS sub;

  -- Niedomyślne ustawienia: advanced (mnożniki/finał) + wygląd ekranu +
  -- tryb wyboru pytań + niestandardowy dźwięk (realnie wgrany plik, nie
  -- sama zmiana głośności). WŁĄCZNIE z grami demo (jak w gameplay).
  SELECT COUNT(*) INTO custom_settings_total FROM public.games g
    WHERE NOT (g.owner_id = ANY(excluded_ids))
      AND (
        (g.settings->'game'->'advanced' IS NOT NULL
          AND g.settings->'game'->'advanced' <> '{}'::jsonb
          AND g.settings->'game'->'advanced' <> '{"roundMultipliers":[1,1,1,2,3],"finalMinPoints":300,"finalTarget":200,"endScreenMode":"money","finalPrizeMultiplier":3,"mainPrizeAmount":25000}'::jsonb)
        OR NOT public._display_is_default(g.settings->'display')
        OR (g.settings->'display'->>'logoId' IS NOT NULL)
        OR (g.settings->'game'->>'hasFinal' = 'false')
        OR (g.settings->'game'->>'finalQuestionsMode' IS NOT NULL AND g.settings->'game'->>'finalQuestionsMode' <> 'random')
        OR (g.settings->'game'->>'roundsQuestionsMode' IS NOT NULL AND g.settings->'game'->>'roundsQuestionsMode' <> 'random')
        OR EXISTS (
          SELECT 1 FROM jsonb_each_text(COALESCE(g.settings->'sound'->'variants', '{}'::jsonb)) v
          WHERE v.value = '__custom__'
        )
      );

  -- Gameplay (game_sessions_effective — realne rozgrywki, WŁĄCZNIE z sesjami
  -- na grach demo: rozegranie gry to działanie użytkownika, nawet jeśli sama
  -- gra została mu dostarczona automatycznie)
  SELECT COUNT(*) INTO played_today FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.started_at >= CURRENT_DATE AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO played_7d FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.started_at >= now() - interval '7 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO played_30d FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.started_at >= now() - interval '30 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO finished_30d FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.effective_status = 'final' AND s.started_at >= now() - interval '30 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO abandoned_30d FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.effective_status = 'abandoned' AND s.started_at >= now() - interval '30 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO in_progress FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.effective_status IN ('started', 'playing') AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO errors_30d FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE COALESCE((s.client_meta->>'error_count')::int, 0) > 0 AND s.started_at >= now() - interval '30 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO legacy_total FROM public.game_sessions_effective s
    JOIN public.games g ON g.id = s.game_id
    WHERE s.status = 'legacy' AND NOT (g.owner_id = ANY(excluded_ids));

  -- Polls
  SELECT COUNT(*) INTO poll_sessions_7d FROM public.poll_sessions ps JOIN public.games g ON g.id = ps.game_id
    WHERE ps.created_at >= now() - interval '7 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO poll_votes_7d    FROM public.poll_votes v JOIN public.games g ON g.id = v.game_id
    WHERE v.created_at >= now() - interval '7 days' AND NOT (g.owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO poll_votes_total FROM public.poll_votes v JOIN public.games g ON g.id = v.game_id
    WHERE NOT (g.owner_id = ANY(excluded_ids));

  -- Question bases
  SELECT COUNT(*) INTO bases_total     FROM public.question_bases WHERE is_demo = false AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO bases_new_today FROM public.question_bases WHERE is_demo = false AND created_at >= CURRENT_DATE AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO bases_new_7d    FROM public.question_bases WHERE is_demo = false AND created_at >= now() - interval '7 days' AND NOT (owner_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO bases_new_30d   FROM public.question_bases WHERE is_demo = false AND created_at >= now() - interval '30 days' AND NOT (owner_id = ANY(excluded_ids));

  -- User logos (user_id — no is_active since migration 208)
  SELECT COUNT(*) INTO logos_total     FROM public.user_logos WHERE is_demo = false AND NOT (user_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO logos_new_today FROM public.user_logos WHERE is_demo = false AND created_at >= CURRENT_DATE AND NOT (user_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO logos_new_7d    FROM public.user_logos WHERE is_demo = false AND created_at >= now() - interval '7 days' AND NOT (user_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO logos_new_30d   FROM public.user_logos WHERE is_demo = false AND created_at >= now() - interval '30 days' AND NOT (user_id = ANY(excluded_ids));

  -- Mail errors
  BEGIN
    SELECT COUNT(*) INTO mail_errors_24h FROM public.mail_queue
      WHERE status = 'failed' AND updated_at >= now() - interval '24 hours';
  EXCEPTION WHEN OTHERS THEN
    mail_errors_24h := 0;
  END;

  -- Ratings
  -- 529: bez kont wykluczonych (testowe i ręcznie); ocena wygasłego gościa
  -- (user_id null) zostaje.
  SELECT COUNT(*) INTO total_ratings FROM public.app_ratings r
    WHERE r.user_id IS NULL OR NOT (r.user_id = ANY(excluded_ids));
  SELECT COALESCE(ROUND(AVG(r.stars), 1), 0) INTO avg_rating FROM public.app_ratings r
    WHERE r.user_id IS NULL OR NOT (r.user_id = ANY(excluded_ids));
  SELECT COUNT(*) INTO ratings_new_today FROM public.app_ratings r WHERE r.created_at >= CURRENT_DATE
    AND (r.user_id IS NULL OR NOT (r.user_id = ANY(excluded_ids)));
  SELECT COUNT(*) INTO ratings_new_7d    FROM public.app_ratings r WHERE r.created_at >= now() - interval '7 days'
    AND (r.user_id IS NULL OR NOT (r.user_id = ANY(excluded_ids)));
  SELECT COUNT(*) INTO ratings_new_30d   FROM public.app_ratings r WHERE r.created_at >= now() - interval '30 days'
    AND (r.user_id IS NULL OR NOT (r.user_id = ANY(excluded_ids)));

  result := jsonb_build_object(
    'timestamp', now(),
    'users', jsonb_build_object(
      'total', total_users,
      'confirmed', confirmed_users,
      'guest', guest_users,
      'new_today', users_new_today,
      'new_7d', users_new_7d,
      'new_30d', users_new_30d,
      'langs', jsonb_build_object('pl', users_pl, 'en', users_en, 'uk', users_uk)
    ),
    'games', jsonb_build_object(
      'total', total_games,
      'ready', games_ready,
      'new_today', games_new_today,
      'new_7d', games_new_7d,
      'new_30d', games_new_30d,
      'avg_q', avg_questions
    ),
    'custom_settings', jsonb_build_object(
      'total', custom_settings_total
    ),
    'gameplay', jsonb_build_object(
      'played_today', played_today,
      'played_7d', played_7d,
      'played_30d', played_30d,
      'finished_30d', finished_30d,
      'abandoned_30d', abandoned_30d,
      'in_progress', in_progress,
      'errors_30d', errors_30d,
      'legacy_total', legacy_total
    ),
    'polls', jsonb_build_object(
      'sessions_7d', poll_sessions_7d,
      'votes_7d', poll_votes_7d,
      'votes_total', poll_votes_total
    ),
    'bases', jsonb_build_object(
      'total', bases_total,
      'new_today', bases_new_today,
      'new_7d', bases_new_7d,
      'new_30d', bases_new_30d
    ),
    'logos', jsonb_build_object(
      'total', logos_total,
      'new_today', logos_new_today,
      'new_7d', logos_new_7d,
      'new_30d', logos_new_30d
    ),
    'health', jsonb_build_object(
      'mail_errors', mail_errors_24h
    ),
    'ratings', jsonb_build_object(
      'total', total_ratings,
      'average', avg_rating,
      'new_today', ratings_new_today,
      'new_7d', ratings_new_7d,
      'new_30d', ratings_new_30d
    )
  );

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."get_stats_detail"("p_type" "text", "p_limit" integer DEFAULT 200) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
DECLARE
  result       jsonb;
  excluded_ids uuid[];
BEGIN
  SELECT ARRAY(SELECT user_id FROM public.stats_exclusions_effective) INTO excluded_ids;

  CASE p_type

  WHEN 'users' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        p.username,
        p.email,
        lower(u.raw_user_meta_data->>'language') AS language,
        p.is_guest,
        p.created_at
      FROM public.profiles p
      JOIN auth.users u ON u.id = p.id
      WHERE NOT (p.id = ANY(excluded_ids))
      ORDER BY p.created_at DESC
      LIMIT p_limit
    ) r;

  WHEN 'games' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        g.name,
        g.type,
        g.status,
        pr.username AS owner,
        g.created_at
      FROM public.games g
      LEFT JOIN public.profiles pr ON pr.id = g.owner_id
      WHERE g.is_demo = false
        AND g.source_market_id IS NULL
        AND NOT (g.owner_id = ANY(excluded_ids))
      ORDER BY g.created_at DESC
      LIMIT p_limit
    ) r;

  WHEN 'custom_settings' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        g.name AS game_name,
        pr.username AS owner,
        g.created_at,
        g.settings->'game'->'advanced' AS advanced,
        g.settings->'display' AS display,
        g.settings->'game'->>'hasFinal' AS has_final,
        g.settings->'game'->>'finalQuestionsMode' AS final_questions_mode,
        g.settings->'game'->>'roundsQuestionsMode' AS rounds_questions_mode,
        g.settings->'sound' AS sound
      FROM public.games g
      LEFT JOIN public.profiles pr ON pr.id = g.owner_id
      WHERE NOT (g.owner_id = ANY(excluded_ids))
        AND (
          (g.settings->'game'->'advanced' IS NOT NULL
            AND g.settings->'game'->'advanced' <> '{}'::jsonb
            AND g.settings->'game'->'advanced' <> '{"roundMultipliers":[1,1,1,2,3],"finalMinPoints":300,"finalTarget":200,"endScreenMode":"money","finalPrizeMultiplier":3,"mainPrizeAmount":25000}'::jsonb)
          OR NOT public._display_is_default(g.settings->'display')
          OR (g.settings->'display'->>'logoId' IS NOT NULL)
          OR (g.settings->'game'->>'hasFinal' = 'false')
          OR (g.settings->'game'->>'finalQuestionsMode' IS NOT NULL AND g.settings->'game'->>'finalQuestionsMode' <> 'random')
          OR (g.settings->'game'->>'roundsQuestionsMode' IS NOT NULL AND g.settings->'game'->>'roundsQuestionsMode' <> 'random')
          OR EXISTS (
            SELECT 1 FROM jsonb_each_text(COALESCE(g.settings->'sound'->'variants', '{}'::jsonb)) v
            WHERE v.value = '__custom__'
          )
        )
      ORDER BY g.created_at DESC
      LIMIT p_limit
    ) r;

  WHEN 'gameplay' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        s.id AS session_id,
        g.name AS game_name,
        pr.username AS owner,
        s.control_version,
        s.stats_detail,
        s.started_at,
        s.ended_at,
        s.status,
        s.effective_status,
        s.rounds_played,
        s.winner_team,
        s.team_a_score,
        s.team_b_score,
        s.rounds_score_a,
        s.rounds_score_b,
        s.final_points,
        s.client_meta->>'final_step' AS final_step,
        COALESCE((s.client_meta->>'error_count')::int, 0) AS error_count
      FROM public.game_sessions_effective s
      JOIN public.games g ON g.id = s.game_id
      LEFT JOIN public.profiles pr ON pr.id = g.owner_id
      WHERE NOT (g.owner_id = ANY(excluded_ids))
      ORDER BY s.started_at DESC
      LIMIT p_limit
    ) r;

  WHEN 'bases' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        b.name,
        pr.username AS owner,
        b.created_at
      FROM public.question_bases b
      LEFT JOIN public.profiles pr ON pr.id = b.owner_id
      WHERE b.is_demo = false
        AND NOT (b.owner_id = ANY(excluded_ids))
      ORDER BY b.created_at DESC
      LIMIT p_limit
    ) r;

  WHEN 'logos' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        l.name,
        l.type,
        pr.username AS owner,
        l.created_at
      FROM public.user_logos l
      LEFT JOIN public.profiles pr ON pr.id = l.user_id
      WHERE l.is_demo = false
        AND NOT (l.user_id = ANY(excluded_ids))
      ORDER BY l.created_at DESC
      LIMIT p_limit
    ) r;

  WHEN 'ratings' THEN
    SELECT jsonb_agg(r)
    INTO result
    FROM (
      SELECT
        pr.username,
        rt.stars,
        rt.comment,
        rt.created_at
      FROM public.app_ratings rt
      LEFT JOIN public.profiles pr ON pr.id = rt.user_id
      WHERE rt.user_id IS NULL OR NOT (rt.user_id = ANY(excluded_ids))
      ORDER BY rt.created_at DESC
      LIMIT p_limit
    ) r;

  ELSE
    result := '[]'::jsonb;
  END CASE;

  RETURN COALESCE(result, '[]'::jsonb);
END;
$$;

-- 3. Gry Społeczności: wspólne przeliczenie ocen i dodań jednej gry.
CREATE OR REPLACE FUNCTION public._market_game_recount(p_game_id uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  UPDATE public.market_games mg SET
    rating_count = (SELECT COUNT(*) FROM public.market_game_ratings r
                    WHERE r.market_game_id = p_game_id
                      AND NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = r.user_id)),
    avg_rating   = COALESCE((SELECT ROUND(AVG(r.stars::numeric), 2) FROM public.market_game_ratings r
                    WHERE r.market_game_id = p_game_id
                      AND NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = r.user_id)), 0),
    library_count = (SELECT COUNT(*) FROM public.user_market_library l
                    WHERE l.market_game_id = p_game_id
                      AND NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = l.user_id))
  WHERE mg.id = p_game_id;
$$;
REVOKE ALL ON FUNCTION public._market_game_recount(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.sync_market_game_rating_stats() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions', 'pg_temp' AS $$
BEGIN
  PERFORM public._market_game_recount(COALESCE(NEW.market_game_id, OLD.market_game_id));
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_market_game_rating_stats() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.trg_market_library_count() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public._market_game_recount(CASE WHEN tg_op = 'DELETE' THEN OLD.market_game_id ELSE NEW.market_game_id END);
  UPDATE public.market_games SET updated_at = now()
   WHERE id = CASE WHEN tg_op = 'DELETE' THEN OLD.market_game_id ELSE NEW.market_game_id END;
  RETURN CASE WHEN tg_op = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
REVOKE ALL ON FUNCTION public.trg_market_library_count() FROM PUBLIC, anon, authenticated;

-- Zmiana wykluczenia ręcznego: przeliczenie gier, które to konto oceniło lub dodało.
CREATE OR REPLACE FUNCTION public.stats_excluded_users_recount() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid := CASE WHEN tg_op = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_game uuid;
BEGIN
  FOR v_game IN
    SELECT market_game_id FROM public.market_game_ratings WHERE user_id = v_user
    UNION SELECT market_game_id FROM public.user_market_library WHERE user_id = v_user
  LOOP
    PERFORM public._market_game_recount(v_game);
  END LOOP;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.stats_excluded_users_recount() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS stats_excluded_users_recount ON public.stats_excluded_users;
CREATE TRIGGER stats_excluded_users_recount AFTER INSERT OR DELETE ON public.stats_excluded_users
  FOR EACH ROW EXECUTE FUNCTION public.stats_excluded_users_recount();

-- 4. Ocena wygasłego gościa zostaje tylko bez żadnego wykluczenia.
CREATE OR REPLACE FUNCTION public.app_ratings_after_unlink() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guest boolean;
BEGIN
  SELECT p.is_guest INTO v_guest FROM public.profiles p WHERE p.id = OLD.user_id;
  IF NOT coalesce(v_guest, NEW.from_guest)
     OR EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = OLD.user_id) THEN
    DELETE FROM public.app_ratings WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.app_ratings_after_unlink() FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.get_admin_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_stats() TO service_role;
REVOKE ALL ON FUNCTION public.get_stats_detail(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_stats_detail(text, integer) TO service_role;

-- Jednorazowe przeliczenie wszystkich gier Społeczności.
DO $$ DECLARE v uuid; BEGIN
  FOR v IN SELECT id FROM public.market_games LOOP PERFORM public._market_game_recount(v); END LOOP;
END $$;
