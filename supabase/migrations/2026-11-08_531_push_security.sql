-- E29 × E24 (przekazanie familijna-server/docs/e24-przekazanie-e29.md):
-- R18 — poczta i zgłoszenia nie zalewają telefonu admina i nie niosą obcego
--        tekstu: najwyżej jedno powiadomienie na 5 minut na rodzaj (kolejne
--        zwiększają licznik w czekającym), bez nadawcy i tematu w treści.
-- R24 — subskrypcji nie da się przejąć znając sam adres endpointu: zapis
--        cudzego endpointu (inne konto albo inna aplikacja) → endpoint_taken.
-- Pkt 5 — agent_reader bez SELECT na push_outbox (vars zawiera nazwy
--        użytkowników); zamiast tego funkcja z samymi liczbami.
-- Zachowane: pomijanie kont wykluczonych z 530 (_push_sender_excluded).

BEGIN;

-- Zdarzenie panelu: jak w 526, plus okno 5 minut dla poczty i zgłoszeń.
CREATE OR REPLACE FUNCTION public.push_admin_event(p_event text, p_vars jsonb DEFAULT '{}', p_urgency text DEFAULT 'normal')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_id bigint; v_event text := p_event; v_vars jsonb := coalesce(p_vars, '{}'); v_n integer;
  v_recent public.push_outbox;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE app = 'admin') THEN RETURN NULL; END IF;
  IF p_event IN ('mail', 'ticket') THEN
    SELECT * INTO v_recent FROM public.push_outbox
     WHERE app = 'admin' AND event = p_event AND created_at > now() - interval '5 minutes'
     ORDER BY id DESC LIMIT 1 FOR UPDATE SKIP LOCKED;
    IF FOUND THEN
      IF v_recent.sent_at IS NULL THEN
        -- jeszcze nie wysłane: jedno powiadomienie z licznikiem
        UPDATE public.push_outbox
           SET vars = vars || jsonb_build_object('n', greatest(
                 coalesce((vars->>'n')::int, 1) + 1, coalesce((v_vars->>'n')::int, 0)))
         WHERE id = v_recent.id;
        RETURN v_recent.id;
      END IF;
      RETURN NULL; -- wysłane przed chwilą: następne najwcześniej po 5 minutach
    END IF;
  END IF;
  IF p_event = 'job_error' THEN
    SELECT count(*) + 1 INTO v_n FROM public.push_outbox
     WHERE app = 'admin' AND event IN ('job_error','job_error_repeat')
       AND vars->>'what' IS NOT DISTINCT FROM v_vars->>'what'
       AND created_at > now() - interval '1 hour';
    IF v_n >= 3 THEN
      v_event := 'job_error_repeat';
      v_vars := v_vars || jsonb_build_object('n', v_n,
        'since', (SELECT min(created_at) FROM public.push_outbox WHERE app = 'admin'
                   AND event IN ('job_error','job_error_repeat') AND vars->>'what' IS NOT DISTINCT FROM v_vars->>'what'
                   AND created_at > now() - interval '1 hour'));
    END IF;
  END IF;
  INSERT INTO public.push_outbox (app, event, category, vars, ttl, urgency)
  VALUES ('admin', v_event, public.push_event_category('admin', v_event), v_vars,
          CASE WHEN v_event LIKE 'job_error%' THEN 3600 ELSE 86400 END,
          CASE WHEN v_event LIKE 'job_error%' THEN 'high' ELSE coalesce(p_urgency, 'normal') END)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.push_admin_event(text, jsonb, text) FROM PUBLIC, anon, authenticated;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.push_admin_event(text, jsonb, text) TO service_role;
  END IF;
END $$;

-- Poczta i zgłoszenia: bez nadawcy i tematu (tekst od obcej osoby), wykluczenia jak w 530.
CREATE OR REPLACE FUNCTION public._push_messages_inbound() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_n integer; v_ticket text;
BEGIN
  IF public._push_sender_excluded(NULL, NEW.from_email) THEN RETURN NULL; END IF;
  IF NEW.source = 'email' THEN
    SELECT count(*) INTO v_n FROM public.messages
     WHERE direction = 'inbound' AND source = 'email' AND NOT is_read AND deleted_at IS NULL
       AND created_at > now() - interval '12 hours';
    PERFORM public.push_admin_event('mail', jsonb_build_object('id', NEW.id, 'n', greatest(v_n, 1)));
  ELSIF NEW.source = 'form' THEN
    SELECT ticket_number INTO v_ticket FROM public.reports WHERE id = NEW.report_id;
    PERFORM public.push_admin_event('ticket', jsonb_build_object('id', NEW.id, 'report_id', NEW.report_id,
      'ticket', left(coalesce(v_ticket, ''), 20), 'n', 1));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_messages_inbound: %', sqlerrm; RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public._push_messages_inbound() FROM PUBLIC, anon, authenticated;

-- R24: zapis tylko własnego endpointu (albo wolnego).
CREATE OR REPLACE FUNCTION public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text DEFAULT 'pl', p_kinds text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_uid uuid := auth.uid(); v_rows integer;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF coalesce((SELECT is_guest FROM public.profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_forbidden');
  END IF;
  IF NOT public.push_endpoint_allowed(p_endpoint) THEN RETURN jsonb_build_object('ok', false, 'error', 'endpoint_not_allowed'); END IF;
  IF p_kinds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_kinds) k WHERE k NOT IN ('friend','poll','subscription','base','device','copy')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kinds');
  END IF;
  INSERT INTO public.push_subscriptions AS s (app, user_id, endpoint, p256dh, auth, lang, kinds, updated_at)
  VALUES ('main', v_uid, p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_lang, ''), 'pl'), coalesce(p_kinds, '{}'), clock_timestamp())
  ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    lang = EXCLUDED.lang, kinds = EXCLUDED.kinds, updated_at = clock_timestamp(), fail_count = 0
    WHERE s.app = 'main' AND s.user_id = v_uid;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'endpoint_taken'); END IF;
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE app = 'main' AND user_id = v_uid
    ORDER BY updated_at DESC OFFSET 20);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.push_subscribe(text, text, text, text, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.push_subscribe(text, text, text, text, text[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.push_admin_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_kinds text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_rows integer;
BEGIN
  IF NOT public.push_endpoint_allowed(p_endpoint) THEN RETURN jsonb_build_object('ok', false, 'error', 'endpoint_not_allowed'); END IF;
  IF p_kinds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_kinds) k WHERE k NOT IN ('mail','ticket','market','collect','errors')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kinds');
  END IF;
  INSERT INTO public.push_subscriptions AS s (app, user_id, endpoint, p256dh, auth, lang, kinds, updated_at)
  VALUES ('admin', NULL, p_endpoint, p_p256dh, p_auth, 'pl', coalesce(p_kinds, '{}'), clock_timestamp())
  ON CONFLICT (endpoint) DO UPDATE SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    kinds = EXCLUDED.kinds, updated_at = clock_timestamp(), fail_count = 0
    WHERE s.app = 'admin';
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN RETURN jsonb_build_object('ok', false, 'error', 'endpoint_taken'); END IF;
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE app = 'admin' ORDER BY updated_at DESC OFFSET 10);
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.push_admin_subscribe(text, text, text, text[]) FROM PUBLIC, anon, authenticated;

-- Pkt 5: agent_reader — tylko liczby.
CREATE OR REPLACE FUNCTION public.push_outbox_stats(p_hours integer DEFAULT 24)
RETURNS TABLE (app text, event text, events bigint, waiting bigint, delivered bigint, failed bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT o.app, o.event, count(*), count(*) FILTER (WHERE o.sent_at IS NULL),
         coalesce(sum(o.delivered), 0), coalesce(sum(o.failed), 0)
    FROM public.push_outbox o
   WHERE o.created_at > now() - make_interval(hours => greatest(1, least(coalesce(p_hours, 24), 336)))
   GROUP BY o.app, o.event ORDER BY o.app, o.event
$$;
REVOKE ALL ON FUNCTION public.push_outbox_stats(integer) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.push_admin_subscribe(text, text, text, text[]) TO service_role;
    GRANT EXECUTE ON FUNCTION public.push_outbox_stats(integer) TO service_role;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    REVOKE SELECT ON public.push_outbox FROM agent_reader;
    GRANT EXECUTE ON FUNCTION public.push_outbox_stats(integer) TO agent_reader;
  END IF;
END $$;

COMMIT;
