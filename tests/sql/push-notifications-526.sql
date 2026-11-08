\set ON_ERROR_STOP 1
-- Test migracji 526 (E29, powiadomienia push): psql -f tests/sql/push-notifications-526.sql
-- Wymaga ról anon/authenticated/service_role (stuby) i nałożonej migracji 526.
BEGIN;
SET LOCAL client_min_messages = warning;
-- Vault (lokalnie stub): push_send_kick przechodzi całą ścieżkę (net.http_post = stub).
INSERT INTO vault.decrypted_secrets (name, decrypted_secret) VALUES
 ('project_url', 'https://api.example.test'), ('anon_key', 'anon'), ('push_send_secret', 'sekret-testowy');

INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-4000-8000-000000000a01', 'a526@example.com'),
 ('00000000-0000-4000-8000-000000000b01', 'b526@example.com'),
 ('00000000-0000-4000-8000-000000000c01', 'g526@example.com');
INSERT INTO public.profiles (id, username, email, is_guest) VALUES
 ('00000000-0000-4000-8000-000000000a01', 'ala526', 'a526@example.com', false),
 ('00000000-0000-4000-8000-000000000b01', 'bart526', 'b526@example.com', false),
 ('00000000-0000-4000-8000-000000000c01', 'gosc526', 'g526@example.com', true);

-- 1. Uprawnienia: tabele i funkcje serwisowe niedostępne dla anon/authenticated.
DO $$
DECLARE f text;
BEGIN
  IF has_table_privilege('authenticated', 'public.push_subscriptions', 'SELECT')
     OR has_table_privilege('anon', 'public.push_outbox', 'SELECT')
     OR has_table_privilege('authenticated', 'public.push_outbox', 'INSERT') THEN
    RAISE EXCEPTION 'tables_exposed';
  END IF;
  FOREACH f IN ARRAY ARRAY['push_admin_subscribe(text,text,text,text[])', 'push_admin_get(text)', 'push_admin_test()',
    'push_outbox_claim(integer)', 'push_user_event(uuid,text,jsonb)', 'push_admin_event(text,jsonb,text)',
    'push_subscription_result(uuid,boolean,boolean)', 'push_send_kick()', 'push_outbox_maintain()'] LOOP
    IF has_function_privilege('authenticated', 'public.' || f, 'EXECUTE') OR has_function_privilege('anon', 'public.' || f, 'EXECUTE') THEN
      RAISE EXCEPTION 'function_exposed: %', f;
    END IF;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.push_subscribe(text,text,text,text,text[])', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_subscribe(text,text,text,text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'subscribe_grant';
  END IF;
END $$;

-- 2. Adresy usług push.
DO $$ BEGIN
  IF NOT public.push_endpoint_allowed('https://fcm.googleapis.com/fcm/send/abc:def')
     OR NOT public.push_endpoint_allowed('https://updates.push.services.mozilla.com/wpush/v2/xyz')
     OR NOT public.push_endpoint_allowed('https://web.push.apple.com/QAbc')
     OR NOT public.push_endpoint_allowed('https://wns2-db5p.notify.windows.com/w/?token=x') THEN
    RAISE EXCEPTION 'allowed_endpoint_rejected';
  END IF;
  IF public.push_endpoint_allowed('https://evil.example.com/fcm.googleapis.com/x')
     OR public.push_endpoint_allowed('http://fcm.googleapis.com/fcm/send/x')
     OR public.push_endpoint_allowed('https://fcm.googleapis.com.evil.com/x')
     OR public.push_endpoint_allowed('https://localhost/x') OR public.push_endpoint_allowed(NULL) THEN
    RAISE EXCEPTION 'bad_endpoint_allowed';
  END IF;
END $$;

-- 3. Zapis urządzenia przez użytkownika.
CREATE TEMP TABLE k(p256dh text, auth text) ON COMMIT DROP;
INSERT INTO k VALUES (repeat('B', 87), repeat('a', 22));
GRANT SELECT ON k TO authenticated;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '', true);
DO $$ BEGIN
  IF public.push_subscribe('https://fcm.googleapis.com/fcm/send/a1', (SELECT p256dh FROM k), (SELECT auth FROM k))->>'error' <> 'not_authenticated' THEN
    RAISE EXCEPTION 'anon_subscribed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000c01', true);
DO $$ BEGIN
  IF public.push_subscribe('https://fcm.googleapis.com/fcm/send/g1', (SELECT p256dh FROM k), (SELECT auth FROM k))->>'error' <> 'guest_forbidden' THEN
    RAISE EXCEPTION 'guest_subscribed'; END IF;
END $$;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a01', true);
DO $$ DECLARE r jsonb; BEGIN
  IF public.push_subscribe('https://evil.example.com/x', (SELECT p256dh FROM k), (SELECT auth FROM k))->>'error' <> 'endpoint_not_allowed' THEN
    RAISE EXCEPTION 'evil_endpoint'; END IF;
  IF public.push_subscribe('https://fcm.googleapis.com/fcm/send/a1', (SELECT p256dh FROM k), (SELECT auth FROM k), 'pl', ARRAY['mail'])->>'error' <> 'invalid_kinds' THEN
    RAISE EXCEPTION 'admin_kind_for_user'; END IF;
  r := public.push_subscribe('https://fcm.googleapis.com/fcm/send/a1', (SELECT p256dh FROM k), (SELECT auth FROM k), 'uk', ARRAY['poll','friend']);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'subscribe_failed %', r; END IF;
  r := public.push_subscription_get('https://fcm.googleapis.com/fcm/send/a1');
  IF NOT (r->>'subscribed')::boolean OR r->'kinds' <> '["poll","friend"]'::jsonb THEN RAISE EXCEPTION 'get_failed %', r; END IF;
  -- 21 urządzeń → zostaje 20
  FOR i IN 2..21 LOOP
    PERFORM public.push_subscribe('https://fcm.googleapis.com/fcm/send/a' || i, (SELECT p256dh FROM k), (SELECT auth FROM k));
  END LOOP;
END $$;

-- Inny użytkownik nie widzi i nie usuwa cudzego urządzenia.
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b01', true);
DO $$ BEGIN
  IF (public.push_subscription_get('https://fcm.googleapis.com/fcm/send/a21')->>'subscribed')::boolean THEN
    RAISE EXCEPTION 'foreign_visible'; END IF;
  PERFORM public.push_unsubscribe('https://fcm.googleapis.com/fcm/send/a21');
END $$;
RESET ROLE;
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_subscriptions WHERE user_id = '00000000-0000-4000-8000-000000000a01') <> 20 THEN
    RAISE EXCEPTION 'device_cap'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a21') THEN
    RAISE EXCEPTION 'foreign_unsubscribed'; END IF;
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = '00000000-0000-4000-8000-000000000c01') THEN
    RAISE EXCEPTION 'guest_row'; END IF;
END $$;

-- Cudzy endpoint nie daje się przejąć (531, R24): endpoint_taken, właściciel bez zmian; wypis cudzego — nic.
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000b01', true);
DO $$ BEGIN
  IF public.push_subscribe('https://fcm.googleapis.com/fcm/send/a21', (SELECT p256dh FROM k), (SELECT auth FROM k))->>'error' <> 'endpoint_taken' THEN
    RAISE EXCEPTION 'takeover_allowed'; END IF;
END $$;
SELECT public.push_unsubscribe('https://fcm.googleapis.com/fcm/send/a20');
RESET ROLE;
DO $$ BEGIN
  IF (SELECT user_id FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a21') <> '00000000-0000-4000-8000-000000000a01' THEN
    RAISE EXCEPTION 'takeover'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a20') THEN
    RAISE EXCEPTION 'foreign_unsubscribe_b'; END IF;
END $$;

-- 4. Zdarzenia użytkownika.
DO $$ BEGIN
  IF public.push_user_event('00000000-0000-4000-8000-000000000c01', 'friend:invite', '{}') IS NOT NULL THEN
    RAISE EXCEPTION 'event_without_device'; END IF;
  IF public.push_user_event('00000000-0000-4000-8000-000000000a01', 'poll:share', '{"name":"X"}') IS NULL THEN
    RAISE EXCEPTION 'event_missing'; END IF;
  IF (SELECT category FROM public.push_outbox WHERE event = 'poll:share') <> 'poll' THEN RAISE EXCEPTION 'category'; END IF;
END $$;

-- 5. Panel admina: bez urządzeń admina zdarzenia nie powstają.
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'x@example.com', 'Bez admina');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.push_outbox WHERE app = 'admin') THEN RAISE EXCEPTION 'admin_event_without_device'; END IF;
END $$;

DO $$ DECLARE r jsonb; BEGIN
  r := public.push_admin_subscribe('https://web.push.apple.com/adm1', repeat('C', 87), repeat('b', 22), ARRAY['mail','errors','collect','market','ticket']);
  IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'admin_subscribe %', r; END IF;
  IF public.push_admin_subscribe('https://web.push.apple.com/adm2', repeat('C', 87), repeat('b', 22), ARRAY['poll'])->>'error' <> 'invalid_kinds' THEN
    RAISE EXCEPTION 'user_kind_for_admin'; END IF;
  IF NOT (public.push_admin_get('https://web.push.apple.com/adm1')->>'subscribed')::boolean THEN RAISE EXCEPTION 'admin_get'; END IF;
END $$;

-- Poczta i zgłoszenia.
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'y@example.com', 'Pytanie o grę');
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('outbound', 'compose', 'kontakt@familijna.app', 'Odpowiedź');
INSERT INTO public.reports (id, ticket_number, subject) VALUES ('00000000-0000-4000-8000-0000000000e1', 'T-526', 'Błąd');
INSERT INTO public.messages (direction, source, from_email, subject, report_id)
  VALUES ('inbound', 'form', 'z@example.com', 'Błąd', '00000000-0000-4000-8000-0000000000e1');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE app = 'admin' AND event = 'mail') <> 1 THEN RAISE EXCEPTION 'mail_event'; END IF;
  IF (SELECT (vars->>'n')::int FROM public.push_outbox WHERE app = 'admin' AND event = 'mail') <> 2 THEN RAISE EXCEPTION 'mail_count'; END IF;
  IF (SELECT vars->>'ticket' FROM public.push_outbox WHERE event = 'ticket') <> 'T-526' THEN RAISE EXCEPTION 'ticket_event'; END IF;
END $$;

-- Gra do zatwierdzenia: tylko społeczność, tylko wejście w pending.
INSERT INTO public.market_games (id, title, lang, payload, status, origin, author_user_id)
  VALUES ('00000000-0000-4000-8000-0000000000f1', 'Gra 526', 'pl', '{}', 'pending', 'community', '00000000-0000-4000-8000-000000000b01');
UPDATE public.market_games SET title = 'Gra 526b' WHERE id = '00000000-0000-4000-8000-0000000000f1';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE event = 'market') <> 1 THEN RAISE EXCEPTION 'market_event'; END IF;
END $$;

-- Zbieranie kontaktów: koniec i błędy (trzeci w godzinie = powtarzający się).
INSERT INTO public.marketing_runs (run_id, target) VALUES ('00000000-0000-4000-8000-0000000000d1', 50);
UPDATE public.marketing_runs SET status = 'completed', verified = 37, finished_at = created_at + interval '42 minutes' WHERE run_id = '00000000-0000-4000-8000-0000000000d1';
INSERT INTO public.marketing_runs (run_id, target) VALUES ('00000000-0000-4000-8000-0000000000d2', 5);
UPDATE public.marketing_runs SET status = 'error' WHERE run_id = '00000000-0000-4000-8000-0000000000d2';
INSERT INTO public.marketing_runs (run_id, target) VALUES ('00000000-0000-4000-8000-0000000000d3', 5);
UPDATE public.marketing_runs SET status = 'error' WHERE run_id = '00000000-0000-4000-8000-0000000000d3';
INSERT INTO public.marketing_runs (run_id, target) VALUES ('00000000-0000-4000-8000-0000000000d4', 5);
UPDATE public.marketing_runs SET status = 'error' WHERE run_id = '00000000-0000-4000-8000-0000000000d4';
DO $$ DECLARE v jsonb; BEGIN
  SELECT vars INTO v FROM public.push_outbox WHERE event = 'collect_done' AND vars->>'what' = 'contacts';
  IF v->>'added' <> '37' OR v->>'minutes' <> '42' THEN RAISE EXCEPTION 'collect_done %', v; END IF;
  IF (SELECT count(*) FROM public.push_outbox WHERE event = 'job_error') <> 2
     OR (SELECT count(*) FROM public.push_outbox WHERE event = 'job_error_repeat') <> 1 THEN
    RAISE EXCEPTION 'error_repeat'; END IF;
  IF (SELECT urgency FROM public.push_outbox WHERE event = 'job_error_repeat') <> 'high'
     OR (SELECT ttl FROM public.push_outbox WHERE event = 'job_error_repeat') <> 3600 THEN
    RAISE EXCEPTION 'error_urgency'; END IF;
END $$;

-- Zbieranie pytań.
INSERT INTO public.producer_question_jobs (id, request_id, lang, kind, target)
  VALUES ('00000000-0000-4000-8000-0000000000c2', gen_random_uuid(), 'pl', 'search', 100);
UPDATE public.producer_question_jobs SET status = 'waiting_budget' WHERE id = '00000000-0000-4000-8000-0000000000c2';
UPDATE public.producer_question_jobs SET status = 'running' WHERE id = '00000000-0000-4000-8000-0000000000c2';
UPDATE public.producer_question_jobs SET status = 'completed', accepted = 85 WHERE id = '00000000-0000-4000-8000-0000000000c2';
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE event = 'collect_paused') <> 1 THEN RAISE EXCEPTION 'collect_paused'; END IF;
  IF (SELECT vars->>'added' FROM public.push_outbox WHERE event = 'collect_done' AND vars->>'what' = 'questions') <> '85' THEN
    RAISE EXCEPTION 'questions_done'; END IF;
END $$;

-- 6. Wysyłka: claim, finish, wynik urządzenia.
DO $$ DECLARE n1 int; n2 int; sid uuid; BEGIN
  SELECT count(*) INTO n1 FROM public.push_outbox_claim(100);
  SELECT count(*) INTO n2 FROM public.push_outbox_claim(100);
  IF n1 = 0 OR n2 <> 0 THEN RAISE EXCEPTION 'claim % %', n1, n2; END IF;
  PERFORM public.push_outbox_finish(id, 1, 0, NULL) FROM public.push_outbox;
  IF EXISTS (SELECT 1 FROM public.push_outbox WHERE sent_at IS NULL) THEN RAISE EXCEPTION 'finish'; END IF;
  SELECT id INTO sid FROM public.push_subscriptions WHERE endpoint = 'https://web.push.apple.com/adm1';
  FOR i IN 1..4 LOOP PERFORM public.push_subscription_result(sid, false); END LOOP;
  IF NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE id = sid) THEN RAISE EXCEPTION 'removed_too_early'; END IF;
  PERFORM public.push_subscription_result(sid, true);
  IF (SELECT fail_count FROM public.push_subscriptions WHERE id = sid) <> 0 THEN RAISE EXCEPTION 'ok_reset'; END IF;
  FOR i IN 1..5 LOOP PERFORM public.push_subscription_result(sid, false); END LOOP;
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE id = sid) THEN RAISE EXCEPTION 'not_removed_after_5'; END IF;
  SELECT id INTO sid FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/a2';
  PERFORM public.push_subscription_result(sid, false, true);
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE id = sid) THEN RAISE EXCEPTION 'gone_not_removed'; END IF;
  PERFORM public.push_outbox_maintain();
END $$;

-- 7. Usunięcie konta usuwa urządzenia i zdarzenia.
DELETE FROM auth.users WHERE id = '00000000-0000-4000-8000-000000000a01';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.push_subscriptions WHERE user_id = '00000000-0000-4000-8000-000000000a01')
     OR EXISTS (SELECT 1 FROM public.push_outbox WHERE user_id = '00000000-0000-4000-8000-000000000a01') THEN
    RAISE EXCEPTION 'cascade'; END IF;
END $$;

SELECT 'push-notifications-526: OK' AS result;
ROLLBACK;
