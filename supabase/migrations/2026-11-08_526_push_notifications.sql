-- E29: powiadomienia push (plan: familijna-server/docs/powiadomienia-push-plan.md).
-- Migracja dodająca: nowe tabele, funkcje i triggery. Nic istniejącego nie
-- zmienia zachowania — wysyłkę robi nowa funkcja Edge push-send; bez niej
-- zdarzenia czekają w push_outbox (cron ponawia, stare sprząta).
--
-- push_subscriptions — urządzenia: aplikacja (app='main', konto użytkownika)
--   i panel admina (app='admin', bez konta — zapis przez Worker panelu za
--   Cloudflare Access, kluczem serwisowym).
-- push_outbox — jedna skrzynka nadawcza: źródła tylko dopisują zdarzenie,
--   wysyła wyłącznie push-send (klucz VAPID tylko tam).

BEGIN;

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app         text NOT NULL CHECK (app IN ('main','admin')),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint    text NOT NULL UNIQUE CHECK (char_length(endpoint) BETWEEN 20 AND 1000),
  p256dh      text NOT NULL CHECK (p256dh ~ '^[A-Za-z0-9_-]{80,100}$'),
  auth        text NOT NULL CHECK (auth ~ '^[A-Za-z0-9_-]{16,32}$'),
  lang        text NOT NULL DEFAULT 'pl' CHECK (lang IN ('pl','en','uk')),
  kinds       text[] NOT NULL DEFAULT '{}' CHECK (cardinality(kinds) <= 20),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  last_ok_at  timestamptz,
  fail_count  integer NOT NULL DEFAULT 0,
  CONSTRAINT push_subscriptions_owner CHECK ((app = 'main') = (user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id) WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS push_subscriptions_admin_idx ON public.push_subscriptions (app) WHERE app = 'admin';
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.push_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  app         text NOT NULL CHECK (app IN ('main','admin')),
  user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  event       text NOT NULL CHECK (event ~ '^[a-z_:]{2,40}$'),
  category    text NOT NULL CHECK (category ~ '^[a-z_]{2,30}$'),
  vars        jsonb NOT NULL DEFAULT '{}' CHECK (pg_column_size(vars) <= 2000),
  ttl         integer NOT NULL DEFAULT 86400 CHECK (ttl BETWEEN 60 AND 604800),
  urgency     text NOT NULL DEFAULT 'normal' CHECK (urgency IN ('low','normal','high')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  claimed_at  timestamptz,
  attempts    integer NOT NULL DEFAULT 0,
  sent_at     timestamptz,
  delivered   integer NOT NULL DEFAULT 0,
  failed      integer NOT NULL DEFAULT 0,
  last_error  text CHECK (char_length(last_error) <= 200),
  CONSTRAINT push_outbox_owner CHECK ((app = 'main') = (user_id IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS push_outbox_pending_idx ON public.push_outbox (id) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS push_outbox_event_idx ON public.push_outbox (app, event, created_at);
ALTER TABLE public.push_outbox ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.push_subscriptions, public.push_outbox FROM PUBLIC, anon, authenticated;

-- Dozwolone usługi push (endpoint z przeglądarki). Ochrona przed wysyłką
-- z serwera pod dowolny adres.
CREATE OR REPLACE FUNCTION public.push_endpoint_allowed(p_endpoint text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $$
  SELECT coalesce(p_endpoint ~ '^https://(fcm\.googleapis\.com|[a-z0-9.-]+\.push\.services\.mozilla\.com|[a-z0-9.-]*push\.apple\.com|[a-z0-9.-]+\.notify\.windows\.com)/[^\s]+$', false)
$$;

-- Rodzaj (do przełączników) dla zdarzenia.
CREATE OR REPLACE FUNCTION public.push_event_category(p_app text, p_event text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'pg_catalog' AS $$
  SELECT CASE
    WHEN p_app = 'admin' THEN CASE
      WHEN p_event IN ('mail') THEN 'mail'
      WHEN p_event IN ('ticket') THEN 'ticket'
      WHEN p_event IN ('market') THEN 'market'
      WHEN p_event IN ('collect_done','collect_paused') THEN 'collect'
      WHEN p_event IN ('job_error','job_error_repeat') THEN 'errors'
      ELSE 'other' END
    ELSE CASE
      WHEN p_event LIKE 'friend:%' THEN 'friend'
      WHEN p_event LIKE 'poll:%' THEN 'poll'
      WHEN p_event LIKE 'subscription:%' THEN 'subscription'
      WHEN p_event LIKE 'base:%' THEN 'base'
      WHEN p_event LIKE 'device:%' THEN 'device'
      WHEN p_event LIKE 'copy:%' THEN 'copy'
      ELSE 'other' END
  END
$$;

-- Wywołanie push-send (jak storage_cleanup_kick): nagłówek
-- X-Internal-Secret = hex(HMAC-SHA256(push_send_secret, 'push-send')).
CREATE OR REPLACE FUNCTION public.push_send_kick() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_base text; v_anon text; v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_base FROM vault.decrypted_secrets WHERE name = 'project_url';
  SELECT decrypted_secret INTO v_anon FROM vault.decrypted_secrets WHERE name = 'anon_key';
  SELECT btrim(decrypted_secret) INTO v_secret FROM vault.decrypted_secrets WHERE name = 'push_send_secret';
  IF coalesce(v_base,'') = '' OR coalesce(v_anon,'') = '' OR coalesce(v_secret,'') = '' THEN
    RAISE WARNING 'push_send_kick: brak project_url/anon_key/push_send_secret w vault';
    RETURN;
  END IF;
  PERFORM net.http_post(
    url := v_base || '/functions/v1/push-send',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || v_anon,
      'apikey', v_anon,
      'X-Internal-Secret', encode(extensions.hmac('push-send', v_secret, 'sha256'), 'hex')),
    body := '{}'::jsonb);
EXCEPTION WHEN others THEN
  -- brak pg_net/vault nie może zablokować zdarzenia źródłowego; cron ponowi
  RAISE WARNING 'push_send_kick: %', sqlerrm;
END $$;
REVOKE ALL ON FUNCTION public.push_send_kick() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public._push_outbox_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN PERFORM public.push_send_kick(); RETURN NULL; END $$;
REVOKE ALL ON FUNCTION public._push_outbox_after_insert() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS push_outbox_kick ON public.push_outbox;
CREATE TRIGGER push_outbox_kick AFTER INSERT ON public.push_outbox
  FOR EACH STATEMENT EXECUTE FUNCTION public._push_outbox_after_insert();

-- Zdarzenie dla użytkownika aplikacji (woła send-mail kluczem serwisowym).
CREATE OR REPLACE FUNCTION public.push_user_event(p_user uuid, p_event text, p_vars jsonb DEFAULT '{}')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_id bigint;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE app = 'main' AND user_id = p_user) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.push_outbox (app, user_id, event, category, vars)
  VALUES ('main', p_user, p_event, public.push_event_category('main', p_event), coalesce(p_vars, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Zdarzenie panelu admina. Błąd tej samej czynności ≥ 3 razy w godzinie
-- (z bieżącym) → job_error_repeat.
CREATE OR REPLACE FUNCTION public.push_admin_event(p_event text, p_vars jsonb DEFAULT '{}', p_urgency text DEFAULT 'normal')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_id bigint; v_event text := p_event; v_vars jsonb := coalesce(p_vars, '{}'); v_n integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE app = 'admin') THEN RETURN NULL; END IF;
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

-- ---------- Aplikacja: urządzenia użytkownika ----------
CREATE OR REPLACE FUNCTION public.push_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_lang text DEFAULT 'pl', p_kinds text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  IF coalesce((SELECT is_guest FROM public.profiles WHERE id = v_uid), false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'guest_forbidden');
  END IF;
  IF NOT public.push_endpoint_allowed(p_endpoint) THEN RETURN jsonb_build_object('ok', false, 'error', 'endpoint_not_allowed'); END IF;
  IF p_kinds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_kinds) k WHERE k NOT IN ('friend','poll','subscription','base','device','copy')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kinds');
  END IF;
  INSERT INTO public.push_subscriptions (app, user_id, endpoint, p256dh, auth, lang, kinds, updated_at)
  VALUES ('main', v_uid, p_endpoint, p_p256dh, p_auth, coalesce(nullif(p_lang, ''), 'pl'), coalesce(p_kinds, '{}'), clock_timestamp())
  ON CONFLICT (endpoint) DO UPDATE SET app = 'main', user_id = v_uid, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    lang = EXCLUDED.lang, kinds = EXCLUDED.kinds, updated_at = clock_timestamp(), fail_count = 0;
  -- najwyżej 20 urządzeń na konto: najstarsze odpadają
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE app = 'main' AND user_id = v_uid
    ORDER BY updated_at DESC OFFSET 20);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.push_unsubscribe(p_endpoint text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated'); END IF;
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND app = 'main' AND user_id = auth.uid();
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.push_subscription_get(p_endpoint text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce(
    (SELECT jsonb_build_object('subscribed', true, 'kinds', to_jsonb(kinds))
       FROM public.push_subscriptions WHERE endpoint = p_endpoint AND app = 'main' AND user_id = auth.uid()),
    jsonb_build_object('subscribed', false, 'kinds', '[]'::jsonb))
$$;

-- ---------- Panel admina (tylko service_role — Worker za Cloudflare Access) ----------
CREATE OR REPLACE FUNCTION public.push_admin_subscribe(p_endpoint text, p_p256dh text, p_auth text, p_kinds text[] DEFAULT '{}')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NOT public.push_endpoint_allowed(p_endpoint) THEN RETURN jsonb_build_object('ok', false, 'error', 'endpoint_not_allowed'); END IF;
  IF p_kinds IS NOT NULL AND EXISTS (SELECT 1 FROM unnest(p_kinds) k WHERE k NOT IN ('mail','ticket','market','collect','errors')) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_kinds');
  END IF;
  INSERT INTO public.push_subscriptions (app, user_id, endpoint, p256dh, auth, lang, kinds, updated_at)
  VALUES ('admin', NULL, p_endpoint, p_p256dh, p_auth, 'pl', coalesce(p_kinds, '{}'), clock_timestamp())
  ON CONFLICT (endpoint) DO UPDATE SET app = 'admin', user_id = NULL, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth,
    lang = 'pl', kinds = EXCLUDED.kinds, updated_at = clock_timestamp(), fail_count = 0;
  DELETE FROM public.push_subscriptions WHERE id IN (
    SELECT id FROM public.push_subscriptions WHERE app = 'admin' ORDER BY updated_at DESC OFFSET 10);
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.push_admin_unsubscribe(p_endpoint text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  WITH d AS (DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint AND app = 'admin' RETURNING 1)
  SELECT jsonb_build_object('ok', true, 'removed', (SELECT count(*) FROM d))
$$;

CREATE OR REPLACE FUNCTION public.push_admin_get(p_endpoint text) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT jsonb_build_object(
    'subscribed', EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = p_endpoint AND app = 'admin'),
    'kinds', coalesce((SELECT to_jsonb(kinds) FROM public.push_subscriptions WHERE endpoint = p_endpoint AND app = 'admin'), '[]'::jsonb),
    'devices', (SELECT count(*) FROM public.push_subscriptions WHERE app = 'admin'),
    'recent', coalesce((SELECT jsonb_agg(r ORDER BY r->>'created_at' DESC) FROM (
       SELECT jsonb_build_object('event', event, 'created_at', created_at, 'sent_at', sent_at,
         'delivered', delivered, 'failed', failed, 'error', last_error) AS r
       FROM public.push_outbox WHERE app = 'admin' ORDER BY id DESC LIMIT 20) x), '[]'::jsonb))
$$;

CREATE OR REPLACE FUNCTION public.push_admin_test() RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT jsonb_build_object('ok', true, 'id', public.push_admin_event('test', '{}'::jsonb, 'high'))
$$;

-- ---------- Wysyłka (push-send, service_role) ----------
CREATE OR REPLACE FUNCTION public.push_outbox_claim(p_limit integer DEFAULT 50)
RETURNS SETOF public.push_outbox LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  UPDATE public.push_outbox o SET claimed_at = now(), attempts = o.attempts + 1
   WHERE o.id IN (
     SELECT id FROM public.push_outbox
      WHERE sent_at IS NULL AND attempts < 5 AND created_at > now() - interval '1 day'
        AND (claimed_at IS NULL OR claimed_at < now() - interval '2 minutes')
      ORDER BY id LIMIT greatest(1, least(coalesce(p_limit, 50), 200))
      FOR UPDATE SKIP LOCKED)
  RETURNING o.*
$$;

CREATE OR REPLACE FUNCTION public.push_outbox_finish(p_id bigint, p_delivered integer, p_failed integer, p_error text DEFAULT NULL)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  UPDATE public.push_outbox SET sent_at = now(), delivered = greatest(0, coalesce(p_delivered, 0)),
    failed = greatest(0, coalesce(p_failed, 0)), last_error = left(p_error, 200)
   WHERE id = p_id
$$;

-- Wynik dla urządzenia: 404/410 (gone) → usunięte; inny błąd → fail_count,
-- po 5 kolejnych usunięte; sukces → zerowanie.
CREATE OR REPLACE FUNCTION public.push_subscription_result(p_id uuid, p_ok boolean, p_gone boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF p_gone THEN DELETE FROM public.push_subscriptions WHERE id = p_id; RETURN; END IF;
  IF p_ok THEN
    UPDATE public.push_subscriptions SET last_ok_at = now(), fail_count = 0 WHERE id = p_id;
  ELSE
    UPDATE public.push_subscriptions SET fail_count = fail_count + 1 WHERE id = p_id;
    DELETE FROM public.push_subscriptions WHERE id = p_id AND fail_count >= 5;
  END IF;
END $$;

-- ---------- Źródła zdarzeń panelu ----------
-- Poczta przychodząca i zgłoszenia z formularza Kontakt.
CREATE OR REPLACE FUNCTION public._push_messages_inbound() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_n integer; v_ticket text;
BEGIN
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
DROP TRIGGER IF EXISTS push_messages_inbound ON public.messages;
CREATE TRIGGER push_messages_inbound AFTER INSERT ON public.messages
  FOR EACH ROW WHEN (NEW.direction = 'inbound' AND NEW.deleted_at IS NULL)
  EXECUTE FUNCTION public._push_messages_inbound();

-- Gra Społeczności czeka na zatwierdzenie.
CREATE OR REPLACE FUNCTION public._push_market_pending() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' THEN RETURN NULL; END IF;
  PERFORM public.push_admin_event('market', jsonb_build_object('id', NEW.id, 'title', left(NEW.title, 60), 'lang', NEW.lang));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_market_pending: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_market_pending ON public.market_games;
CREATE TRIGGER push_market_pending AFTER INSERT OR UPDATE OF status ON public.market_games
  FOR EACH ROW WHEN (NEW.status = 'pending' AND NEW.origin = 'community')
  EXECUTE FUNCTION public._push_market_pending();

-- Zbieranie kontaktów (Lead Finder): koniec lub błąd przebiegu.
CREATE OR REPLACE FUNCTION public._push_marketing_run() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    PERFORM public.push_admin_event('collect_done', jsonb_build_object('what', 'contacts', 'id', NEW.run_id,
      'added', NEW.verified, 'target', NEW.target,
      'minutes', greatest(0, round(extract(epoch FROM coalesce(NEW.finished_at, now()) - NEW.created_at) / 60))::int));
  ELSIF NEW.status = 'error' THEN
    PERFORM public.push_admin_event('job_error', jsonb_build_object('what', 'contacts', 'id', NEW.run_id));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_marketing_run: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_marketing_run ON public.marketing_runs;
CREATE TRIGGER push_marketing_run AFTER UPDATE OF status ON public.marketing_runs
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed','error'))
  EXECUTE FUNCTION public._push_marketing_run();

-- Zbieranie pytań: koniec, wstrzymanie z braku limitu, wymaga uwagi.
CREATE OR REPLACE FUNCTION public._push_question_job() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.status = 'completed' THEN
    PERFORM public.push_admin_event('collect_done', jsonb_build_object('what', 'questions', 'id', NEW.id,
      'added', NEW.accepted, 'target', NEW.target, 'lang', NEW.lang));
  ELSIF NEW.status = 'waiting_budget' THEN
    PERFORM public.push_admin_event('collect_paused', jsonb_build_object('what', 'questions', 'id', NEW.id, 'lang', NEW.lang));
  ELSIF NEW.status = 'needs_attention' THEN
    PERFORM public.push_admin_event('job_error', jsonb_build_object('what', 'questions', 'id', NEW.id,
      'lang', NEW.lang, 'reason', left(coalesce(NEW.message, ''), 80)));
  END IF;
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_question_job: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_question_job ON public.producer_question_jobs;
CREATE TRIGGER push_question_job AFTER UPDATE OF status ON public.producer_question_jobs
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('completed','waiting_budget','needs_attention'))
  EXECUTE FUNCTION public._push_question_job();

-- ---------- Uprawnienia ----------
DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY[
    'push_endpoint_allowed(text)', 'push_event_category(text,text)',
    'push_user_event(uuid,text,jsonb)', 'push_admin_event(text,jsonb,text)',
    'push_admin_subscribe(text,text,text,text[])', 'push_admin_unsubscribe(text)', 'push_admin_get(text)', 'push_admin_test()',
    'push_outbox_claim(integer)', 'push_outbox_finish(bigint,integer,integer,text)', 'push_subscription_result(uuid,boolean,boolean)',
    '_push_messages_inbound()', '_push_market_pending()', '_push_marketing_run()', '_push_question_job()',
    'push_subscribe(text,text,text,text,text[])', 'push_unsubscribe(text)', 'push_subscription_get(text)']
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
    END IF;
  END LOOP;
  GRANT EXECUTE ON FUNCTION public.push_subscribe(text,text,text,text,text[]),
    public.push_unsubscribe(text), public.push_subscription_get(text) TO authenticated;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.push_subscriptions, public.push_outbox TO service_role;
  END IF;
END $$;

-- ---------- Cron: dosyłanie zaległych i sprzątanie ----------
CREATE OR REPLACE FUNCTION public.push_outbox_maintain() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  DELETE FROM public.push_outbox WHERE created_at < now() - interval '14 days';
  IF EXISTS (SELECT 1 FROM public.push_outbox WHERE sent_at IS NULL AND attempts < 5
               AND created_at > now() - interval '1 day' AND created_at < now() - interval '1 minute') THEN
    PERFORM public.push_send_kick();
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.push_outbox_maintain() FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'familijna_push_outbox') THEN
   PERFORM cron.unschedule('familijna_push_outbox');
  END IF;
  PERFORM cron.schedule('familijna_push_outbox', '* * * * *', 'SELECT public.push_outbox_maintain()');
 END IF;
END $$;

COMMIT;
