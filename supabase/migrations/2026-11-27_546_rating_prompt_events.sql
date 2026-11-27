-- 546: zdarzenia prośby o ocenę systemu (decyzja użytkownika 2026-11-27):
-- każde pokazanie prośby i wybór użytkownika trafiają do bazy, panel admina
-- pokazuje lejek za 7 i 30 dni (Oceny).
--  * outcome: shown (okno pokazane), sent (ocena wysłana), later („Później”),
--    never („Nie pytaj więcej”), closed (X, Esc, klik w tło -- jak „Później”).
--  * page: identyfikator strony (initPage), bez adresu i parametrów.
--  * from_guest i test_account ustawiane przy zapisie z profilu i wykluczeń
--    (stats_exclusions_effective) -- po usunięciu konta (user_id -> null,
--    np. wygasły gość) zdarzenie zostaje i dalej wiadomo, czy było testowe.
--  * zapis tylko przez app_rating_prompt_log (bez polityk RLS dla stron),
--    najwyżej 40 zdarzeń konta na dobę (nadmiar pomijany bez błędu).
-- Dodająca, zgodna wstecz: obecne strony nic nie zapisują.

CREATE TABLE IF NOT EXISTS public.app_rating_prompt_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  outcome text NOT NULL CHECK (outcome IN ('shown', 'sent', 'later', 'never', 'closed')),
  page text NOT NULL CHECK (page ~ '^[A-Za-z]{1,32}$'),
  from_guest boolean NOT NULL DEFAULT false,
  test_account boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS app_rating_prompt_events_created_idx ON public.app_rating_prompt_events (created_at);
CREATE INDEX IF NOT EXISTS app_rating_prompt_events_user_idx ON public.app_rating_prompt_events (user_id, created_at);
ALTER TABLE public.app_rating_prompt_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.app_rating_prompt_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_rating_prompt_events TO service_role;

CREATE OR REPLACE FUNCTION public.app_rating_prompt_log(p_outcome text, p_page text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN false; END IF;
  IF p_outcome IS NULL OR p_outcome NOT IN ('shown', 'sent', 'later', 'never', 'closed') THEN RETURN false; END IF;
  IF p_page IS NULL OR p_page !~ '^[A-Za-z]{1,32}$' THEN RETURN false; END IF;
  IF (SELECT count(*) FROM public.app_rating_prompt_events e
        WHERE e.user_id = v_uid AND e.created_at > now() - interval '1 day') >= 40 THEN
    RETURN false;
  END IF;
  INSERT INTO public.app_rating_prompt_events (user_id, outcome, page, from_guest, test_account)
  VALUES (
    v_uid, p_outcome, p_page,
    coalesce((SELECT p.is_guest FROM public.profiles p WHERE p.id = v_uid), false),
    EXISTS (SELECT 1 FROM public.stats_exclusions_effective x WHERE x.user_id = v_uid)
  );
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION public.app_rating_prompt_log(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.app_rating_prompt_log(text, text) TO authenticated;

-- Lejek dla panelu admina: liczby zdarzeń i kont za 7 i 30 dni, osobno goście,
-- bez kont testowych i wykluczonych.
CREATE OR REPLACE FUNCTION public.get_rating_prompt_funnel()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH ev AS (
    SELECT e.* FROM public.app_rating_prompt_events e
    WHERE NOT e.test_account
      AND (e.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective x WHERE x.user_id = e.user_id))
      AND e.created_at >= now() - interval '30 days'
  ), win AS (
    SELECT 'd7' AS k, interval '7 days' AS span UNION ALL SELECT 'd30', interval '30 days'
  )
  SELECT coalesce(jsonb_object_agg(w.k, jsonb_build_object(
    'shown',  (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'shown'),
    'sent',   (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'sent'),
    'later',  (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'later'),
    'never',  (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'never'),
    'closed', (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'closed'),
    'users',  (SELECT count(DISTINCT user_id) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'shown'),
    'guest_shown', (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'shown' AND from_guest),
    'guest_sent',  (SELECT count(*) FROM ev WHERE ev.created_at >= now() - w.span AND outcome = 'sent' AND from_guest)
  )), '{}'::jsonb)
  FROM win w;
$$;
REVOKE ALL ON FUNCTION public.get_rating_prompt_funnel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_rating_prompt_funnel() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    GRANT SELECT ON public.app_rating_prompt_events TO agent_reader;
  END IF;
END $$;
