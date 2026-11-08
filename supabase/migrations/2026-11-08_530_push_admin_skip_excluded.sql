-- Powiadomienia push admina bez kont wykluczonych (zgłoszenie użytkownika 2026-11-08:
-- powiadomienie o testowym zgłoszeniu gry ze Społeczności). Zasada „wykluczenia
-- wykluczają wszystko”: gra do moderacji, mail i zgłoszenie z formularza od konta
-- testowego albo wykluczonego ręcznie (stats_exclusions_effective) lub z adresu
-- testowego (is_test_email) nie wysyłają powiadomienia. Lista gier do moderacji
-- i poczta w panelu już je pomijają (461).

CREATE OR REPLACE FUNCTION public._push_sender_excluded(p_user uuid, p_email text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = p_user)
      OR (nullif(btrim(p_email), '') IS NOT NULL AND (
            public.is_test_email(p_email)
            OR EXISTS (SELECT 1 FROM public.profiles p
                       JOIN public.stats_exclusions_effective e ON e.user_id = p.id
                       WHERE lower(p.email) = lower(btrim(p_email)))));
$$;
REVOKE ALL ON FUNCTION public._push_sender_excluded(uuid, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._push_market_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' THEN RETURN NULL; END IF;
  IF public._push_sender_excluded(NEW.author_user_id, NULL) THEN RETURN NULL; END IF;
  PERFORM public.push_admin_event('market', jsonb_build_object('id', NEW.id, 'title', left(NEW.title, 60), 'lang', NEW.lang));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_market_pending: %', sqlerrm; RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._push_market_pending() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._push_messages_inbound() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_n integer; v_ticket text;
BEGIN
  IF public._push_sender_excluded(NULL, NEW.from_email) THEN RETURN NULL; END IF;
  IF NEW.source = 'email' THEN
    SELECT count(*) INTO v_n FROM public.messages
     WHERE direction = 'inbound' AND source = 'email' AND NOT is_read AND deleted_at IS NULL
       AND created_at > now() - interval '12 hours';
    PERFORM public.push_admin_event('mail', jsonb_build_object('id', NEW.id,
      'from', left(coalesce(NEW.from_email, ''), 60), 'subject', left(coalesce(NEW.subject, ''), 80),
      'n', greatest(v_n, 1)));
  ELSIF NEW.source = 'form' THEN
    SELECT ticket_number INTO v_ticket FROM public.reports WHERE id = NEW.report_id;
    PERFORM public.push_admin_event('ticket', jsonb_build_object('id', NEW.id, 'report_id', NEW.report_id,
      'ticket', coalesce(v_ticket, ''), 'from', left(coalesce(NEW.from_email, ''), 60),
      'subject', left(coalesce(NEW.subject, ''), 80)));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_messages_inbound: %', sqlerrm; RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._push_messages_inbound() FROM PUBLIC, anon, authenticated;
