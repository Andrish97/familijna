\set ON_ERROR_STOP 1
-- Test migracji 527 (E29 P5: zdarzenia push aplikacji): psql -f tests/sql/push-app-events-527.sql
-- Wymaga nałożonych migracji 526 i 527 (lokalny Postgres ze stubami).
BEGIN;
SET LOCAL client_min_messages = warning;

INSERT INTO auth.users (id, email) VALUES
 ('00000000-0000-4000-8000-000000000a27', 'a527@example.com'),
 ('00000000-0000-4000-8000-000000000b27', 'b527@example.com');
INSERT INTO public.profiles (id, username, email) VALUES
 ('00000000-0000-4000-8000-000000000a27', 'Ala527', 'a527@example.com'),
 ('00000000-0000-4000-8000-000000000b27', 'Bartek527', 'b527@example.com');

-- Bez urządzenia odbiorcy: nic nie powstaje.
INSERT INTO public.friendships (id, requester_id, addressee_id, decision_user_id)
  VALUES ('00000000-0000-4000-8000-0000000001f1', '00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-000000000b27', '00000000-0000-4000-8000-000000000b27');
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.push_outbox WHERE app = 'main') THEN RAISE EXCEPTION 'event_without_device'; END IF;
END $$;
DELETE FROM public.friendships WHERE id = '00000000-0000-4000-8000-0000000001f1';

-- Urządzenie odbiorcy (B) — z wyłączonymi mailami (push niezależny).
INSERT INTO public.push_subscriptions (app, user_id, endpoint, p256dh, auth)
  VALUES ('main', '00000000-0000-4000-8000-000000000b27', 'https://fcm.googleapis.com/fcm/send/b527', repeat('B', 87), repeat('a', 22));
INSERT INTO public.user_flags (user_id, email_notifications) VALUES ('00000000-0000-4000-8000-000000000b27', false)
  ON CONFLICT (user_id) DO UPDATE SET email_notifications = false;

-- 1. Zaproszenie do znajomych + ponowienie po odmowie + brak powtórki.
INSERT INTO public.friendships (id, requester_id, addressee_id, decision_user_id)
  VALUES ('00000000-0000-4000-8000-0000000001f2', '00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-000000000b27', '00000000-0000-4000-8000-000000000b27');
UPDATE public.friendships SET status = 'pending' WHERE id = '00000000-0000-4000-8000-0000000001f2';
DO $$ DECLARE v jsonb; BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE event = 'friend:invite') <> 1 THEN RAISE EXCEPTION 'friend_invite_count'; END IF;
  SELECT vars INTO v FROM public.push_outbox WHERE event = 'friend:invite';
  IF v->>'owner' <> 'Ala527' OR v->>'url' NOT LIKE '/go/?f=%' THEN RAISE EXCEPTION 'friend_vars %', v; END IF;
  IF (SELECT category FROM public.push_outbox WHERE event = 'friend:invite') <> 'friend' THEN RAISE EXCEPTION 'friend_category'; END IF;
END $$;

-- 2. Oferta kopii gry i logo.
INSERT INTO public.resource_copy_offers (recipient_id, sender_id, sender_identity, sender_label, source_id, resource_kind, variant, name, request_id, payload_hash)
  VALUES ('00000000-0000-4000-8000-000000000b27', '00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-000000000a27', 'Ala527',
          gen_random_uuid(), 'game', 'prepared', 'Quiz rodzinny', gen_random_uuid(), repeat('a', 64)),
         ('00000000-0000-4000-8000-000000000b27', '00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-000000000a27', 'Ala527',
          gen_random_uuid(), 'logo', 'PIX_150x70', 'Logo', gen_random_uuid(), repeat('b', 64));
DO $$ BEGIN
  IF (SELECT count(*) FROM public.push_outbox WHERE event IN ('copy:game','copy:logo')) <> 2 THEN RAISE EXCEPTION 'copy_events'; END IF;
  IF (SELECT vars->>'name' FROM public.push_outbox WHERE event = 'copy:game') <> 'Quiz rodzinny' THEN RAISE EXCEPTION 'copy_name'; END IF;
END $$;

-- 3. Ankieta i przypomnienie.
INSERT INTO public.games (id, owner_id, name) VALUES ('00000000-0000-4000-8000-0000000009a1', '00000000-0000-4000-8000-000000000a27', 'Gra 527');
INSERT INTO public.poll_tasks (id, owner_id, recipient_user_id, game_id, poll_type, share_key_poll)
  VALUES ('00000000-0000-4000-8000-0000000009b1', '00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-000000000b27',
          '00000000-0000-4000-8000-0000000009a1', 'poll_text', 'k527');
UPDATE public.poll_tasks SET reminder_count = reminder_count + 1 WHERE id = '00000000-0000-4000-8000-0000000009b1';
UPDATE public.poll_tasks SET opened_at = now() WHERE id = '00000000-0000-4000-8000-0000000009b1';
DO $$ BEGIN
  IF (SELECT vars->>'name' FROM public.push_outbox WHERE event = 'poll:share') <> 'Gra 527' THEN RAISE EXCEPTION 'poll_share'; END IF;
  IF (SELECT count(*) FROM public.push_outbox WHERE event = 'poll:remind') <> 1 THEN RAISE EXCEPTION 'poll_remind'; END IF;
  IF (SELECT category FROM public.push_outbox WHERE event = 'poll:remind') <> 'poll' THEN RAISE EXCEPTION 'poll_category'; END IF;
END $$;

-- 4. Baza pytań.
INSERT INTO public.question_bases (id, owner_id, name) VALUES ('00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-000000000a27', 'Baza 527');
INSERT INTO public.base_share_tasks (owner_id, base_id, recipient_user_id)
  VALUES ('00000000-0000-4000-8000-000000000a27', '00000000-0000-4000-8000-0000000009c1', '00000000-0000-4000-8000-000000000b27');
DO $$ BEGIN
  IF (SELECT vars->>'base' FROM public.push_outbox WHERE event = 'base:share') <> 'Baza 527' THEN RAISE EXCEPTION 'base_share'; END IF;
END $$;

-- 5. Nadawca nie dostaje własnych zdarzeń; wszystkie u odbiorcy.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.push_outbox WHERE app = 'main' AND user_id <> '00000000-0000-4000-8000-000000000b27') THEN
    RAISE EXCEPTION 'wrong_recipient'; END IF;
  IF has_function_privilege('authenticated', 'public._push_user_label(uuid)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.push_user_event(uuid,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'exposed'; END IF;
END $$;

SELECT 'push-app-events-527: OK' AS result;
ROLLBACK;
