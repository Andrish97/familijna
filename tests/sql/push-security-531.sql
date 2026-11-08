\set ON_ERROR_STOP 1
-- Test migracji 531 (E29 × E24: R18, R24, odczyt agentów): psql -f tests/sql/push-security-531.sql
-- Wymaga nałożonych 526, 527 (push_app_events), 530 i 531.
BEGIN;
SET LOCAL client_min_messages = warning;

INSERT INTO auth.users (id, email) VALUES ('00000000-0000-4000-8000-000000000a31', 'a531@example.com');
INSERT INTO public.profiles (id, username, email) VALUES ('00000000-0000-4000-8000-000000000a31', 'ala531', 'a531@example.com');

-- R24: endpoint użytkownika nie przechodzi do panelu i odwrotnie.
INSERT INTO public.push_subscriptions (app, user_id, endpoint, p256dh, auth)
  VALUES ('main', '00000000-0000-4000-8000-000000000a31', 'https://fcm.googleapis.com/fcm/send/u531', repeat('B', 87), repeat('a', 22));
DO $$ BEGIN
  IF public.push_admin_subscribe('https://fcm.googleapis.com/fcm/send/u531', repeat('C', 87), repeat('b', 22))->>'error' <> 'endpoint_taken' THEN
    RAISE EXCEPTION 'admin_took_user_endpoint'; END IF;
  IF (SELECT app FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/u531') <> 'main'
     OR (SELECT p256dh FROM public.push_subscriptions WHERE endpoint = 'https://fcm.googleapis.com/fcm/send/u531') <> repeat('B', 87) THEN
    RAISE EXCEPTION 'user_endpoint_changed'; END IF;
  IF NOT (public.push_admin_subscribe('https://web.push.apple.com/adm531', repeat('C', 87), repeat('b', 22))->>'ok')::boolean THEN
    RAISE EXCEPTION 'admin_subscribe'; END IF;
  -- ponowny zapis własnego (np. zmiana zdarzeń) działa
  IF NOT (public.push_admin_subscribe('https://web.push.apple.com/adm531', repeat('D', 87), repeat('c', 22), ARRAY['mail'])->>'ok')::boolean THEN
    RAISE EXCEPTION 'admin_resubscribe'; END IF;
END $$;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-000000000a31', true);
DO $$ BEGIN
  IF public.push_subscribe('https://web.push.apple.com/adm531', repeat('B', 87), repeat('a', 22))->>'error' <> 'endpoint_taken' THEN
    RAISE EXCEPTION 'user_took_admin_endpoint'; END IF;
  IF NOT (public.push_subscribe('https://fcm.googleapis.com/fcm/send/u531', repeat('E', 87), repeat('d', 22), 'en')->>'ok')::boolean THEN
    RAISE EXCEPTION 'own_resubscribe'; END IF;
END $$;
RESET ROLE;

-- R18: poczta — jedno powiadomienie na 5 minut, licznik w czekającym, bez nadawcy i tematu.
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'x@example.com', 'Kliknij tutaj!!!');
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'y@example.com', 'Drugi');
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'z@example.com', 'Trzeci');
DO $$ DECLARE v jsonb; BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE app = 'admin' AND event = 'mail') <> 1 THEN RAISE EXCEPTION 'mail_flood'; END IF;
  SELECT vars INTO v FROM public.push_outbox WHERE app = 'admin' AND event = 'mail';
  IF (v->>'n')::int < 3 THEN RAISE EXCEPTION 'mail_count %', v; END IF;
  IF v ? 'from' OR v ? 'subject' THEN RAISE EXCEPTION 'foreign_text %', v; END IF;
END $$;
-- po wysłaniu: kolejne maile w tym samym oknie nic nie dodają
UPDATE public.push_outbox SET sent_at = now() WHERE app = 'admin' AND event = 'mail';
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'w@example.com', 'Czwarty');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE app = 'admin' AND event = 'mail') <> 1 THEN RAISE EXCEPTION 'mail_after_sent'; END IF;
END $$;
-- po 5 minutach — znowu jedno
UPDATE public.push_outbox SET created_at = now() - interval '6 minutes' WHERE app = 'admin' AND event = 'mail';
INSERT INTO public.messages (direction, source, from_email, subject) VALUES ('inbound', 'email', 'v@example.com', 'Piąty');
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE app = 'admin' AND event = 'mail') <> 2 THEN RAISE EXCEPTION 'mail_window'; END IF;
END $$;

-- Zgłoszenia: numer zostaje (nasz), bez nadawcy i tematu; dwa w oknie = jedno z licznikiem.
INSERT INTO public.reports (id, ticket_number, subject) VALUES
 ('00000000-0000-4000-8000-0000000003e1', 'T-5311', 'x'), ('00000000-0000-4000-8000-0000000003e2', 'T-5312', 'y');
INSERT INTO public.messages (direction, source, from_email, subject, report_id) VALUES
 ('inbound', 'form', 'f1@example.com', 'Obcy tekst', '00000000-0000-4000-8000-0000000003e1');
INSERT INTO public.messages (direction, source, from_email, subject, report_id) VALUES
 ('inbound', 'form', 'f2@example.com', 'Obcy tekst 2', '00000000-0000-4000-8000-0000000003e2');
DO $$ DECLARE v jsonb; BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE event = 'ticket') <> 1 THEN RAISE EXCEPTION 'ticket_flood'; END IF;
  SELECT vars INTO v FROM public.push_outbox WHERE event = 'ticket';
  IF v->>'ticket' <> 'T-5311' OR (v->>'n')::int <> 2 OR v ? 'from' OR v ? 'subject' THEN RAISE EXCEPTION 'ticket_vars %', v; END IF;
END $$;

-- Statystyki: same liczby; funkcja niedostępna dla stron.
DO $$ BEGIN
  IF (SELECT events FROM public.push_outbox_stats(24) WHERE app = 'admin' AND event = 'mail') <> 2 THEN RAISE EXCEPTION 'stats'; END IF;
  IF has_function_privilege('authenticated', 'public.push_outbox_stats(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_outbox_stats(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.push_subscribe(text,text,text,text,text[])', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.push_subscribe(text,text,text,text,text[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'grants'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader')
     AND has_table_privilege('agent_reader', 'public.push_outbox', 'SELECT') THEN RAISE EXCEPTION 'agent_reader_select'; END IF;
END $$;

SELECT 'push-security-531: OK' AS result;
ROLLBACK;
