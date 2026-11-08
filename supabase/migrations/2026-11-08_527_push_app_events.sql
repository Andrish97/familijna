-- E29 P5: zdarzenia push aplikacji (decyzja użytkownika 2026-11-08: te same
-- sprawy co maile, mail i push wyłączane osobno). Źródłem są tabele spraw
-- (zaproszenia, zadania ankiet, udostępnienia, oferty kopii), a nie przydział
-- maila — przydział nie powstaje, gdy odbiorca wyłączył maile.
-- Dodająca: nowe triggery i funkcje; friends_resend dostaje jedno wywołanie
-- push (reszta bez zmian). Bez zapisanych urządzeń odbiorcy nic nie powstaje.

BEGIN;

-- Nazwa nadawcy do treści (nazwa użytkownika; bez e-maili).
CREATE OR REPLACE FUNCTION public._push_user_label(p_user uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
  SELECT coalesce(nullif(btrim(p.username), ''), 'Familijna') FROM public.profiles p WHERE p.id = p_user
$$;

-- Zdarzenie użytkownika: bez urządzeń — nic; to samo zdarzenie tej samej
-- sprawy (vars.id) w ciągu 10 minut — nic (ochrona przed powtórkami).
CREATE OR REPLACE FUNCTION public.push_user_event(p_user uuid, p_event text, p_vars jsonb DEFAULT '{}')
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_id bigint;
BEGIN
  IF p_user IS NULL OR NOT EXISTS (SELECT 1 FROM public.push_subscriptions WHERE app = 'main' AND user_id = p_user) THEN
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM public.push_outbox WHERE app = 'main' AND user_id = p_user AND event = p_event
               AND vars->>'id' IS NOT DISTINCT FROM p_vars->>'id' AND created_at > now() - interval '10 minutes') THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.push_outbox (app, user_id, event, category, vars)
  VALUES ('main', p_user, p_event, public.push_event_category('main', p_event), coalesce(p_vars, '{}'))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

-- Zaproszenie do znajomych (nowe albo ponowione po odmowie).
CREATE OR REPLACE FUNCTION public._push_friendship() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.status <> 'pending' OR NEW.cancelled_at IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' AND OLD.cancelled_at IS NULL THEN RETURN NULL; END IF;
  PERFORM public.push_user_event(NEW.addressee_id, 'friend:invite', jsonb_build_object(
    'id', NEW.id, 'owner', public._push_user_label(NEW.requester_id), 'url', '/go/?f=' || NEW.token));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_friendship: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_friendship ON public.friendships;
CREATE TRIGGER push_friendship AFTER INSERT OR UPDATE OF status, cancelled_at ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION public._push_friendship();

-- Ankieta do zagłosowania i przypomnienie (reminder_count).
CREATE OR REPLACE FUNCTION public._push_poll_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
DECLARE v_event text;
BEGIN
  IF NEW.recipient_user_id IS NULL OR NEW.status NOT IN ('pending','opened') OR NEW.cancelled_at IS NOT NULL OR NEW.declined_at IS NOT NULL THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN v_event := 'poll:share';
  ELSIF NEW.reminder_count > OLD.reminder_count THEN v_event := 'poll:remind';
  ELSE RETURN NULL; END IF;
  PERFORM public.push_user_event(NEW.recipient_user_id, v_event, jsonb_build_object(
    'id', NEW.id, 'owner', public._push_user_label(NEW.owner_id),
    'name', (SELECT g.name FROM public.games g WHERE g.id = NEW.game_id), 'url', '/go/?t=' || NEW.token));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_poll_task: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_poll_task ON public.poll_tasks;
CREATE TRIGGER push_poll_task AFTER INSERT OR UPDATE OF reminder_count ON public.poll_tasks
  FOR EACH ROW EXECUTE FUNCTION public._push_poll_task();

-- Udostępniona baza pytań.
CREATE OR REPLACE FUNCTION public._push_base_share() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.recipient_user_id IS NULL OR NEW.status <> 'pending' OR NEW.cancelled_at IS NOT NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'pending' THEN RETURN NULL; END IF;
  PERFORM public.push_user_event(NEW.recipient_user_id, 'base:share', jsonb_build_object(
    'id', NEW.id, 'owner', public._push_user_label(NEW.owner_id),
    'base', (SELECT b.name FROM public.question_bases b WHERE b.id = NEW.base_id), 'url', '/go/?b=' || NEW.token));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_base_share: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_base_share ON public.base_share_tasks;
CREATE TRIGGER push_base_share AFTER INSERT OR UPDATE OF status ON public.base_share_tasks
  FOR EACH ROW EXECUTE FUNCTION public._push_base_share();

-- Udostępnione urządzenie (Control).
CREATE OR REPLACE FUNCTION public._push_device_share() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.recipient_id IS NULL OR NEW.revoked_at IS NOT NULL THEN RETURN NULL; END IF;
  PERFORM public.push_user_event(NEW.recipient_id, 'device:share', jsonb_build_object(
    'id', NEW.id, 'owner', public._push_user_label(NEW.owner_id), 'type', NEW.device_type,
    'url', '/go/?d=' || NEW.device_type || '&id=' || NEW.game_id || '&key=' || NEW.token));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_device_share: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_device_share ON public.control_device_shares;
CREATE TRIGGER push_device_share AFTER INSERT ON public.control_device_shares
  FOR EACH ROW EXECUTE FUNCTION public._push_device_share();

-- Oferta kopii gry albo logo.
CREATE OR REPLACE FUNCTION public._push_copy_offer() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $$
BEGIN
  IF NEW.status <> 'pending' OR NEW.resource_kind NOT IN ('game','logo') THEN RETURN NULL; END IF;
  PERFORM public.push_user_event(NEW.recipient_id, 'copy:' || NEW.resource_kind, jsonb_build_object(
    'id', NEW.id, 'owner', coalesce(nullif(btrim(NEW.sender_label), ''), public._push_user_label(NEW.sender_id)),
    'name', NEW.name, 'url', '/go/?c=' || NEW.token));
  RETURN NULL;
EXCEPTION WHEN others THEN
  RAISE WARNING '_push_copy_offer: %', sqlerrm; RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS push_copy_offer ON public.resource_copy_offers;
CREATE TRIGGER push_copy_offer AFTER INSERT ON public.resource_copy_offers
  FOR EACH ROW EXECUTE FUNCTION public._push_copy_offer();

-- Ponowienie zaproszenia do znajomych: push także przy wyłączonych mailach
-- (dotąd tylko mail, gdy odbiorca go nie wyłączył). Reszta jak w 456.
CREATE OR REPLACE FUNCTION public.friends_resend(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp' AS $$
DECLARE result jsonb; f public.friendships%rowtype;
BEGIN
 FOR attempt IN 1..1000 LOOP
  BEGIN
 result:=public._mail_original361_friends_resend(p_id);
 IF result->>'ok'='true' AND result->>'to' IS NOT NULL THEN PERFORM public._mail_allocate_notification('friend',p_id,'friend:resend'); END IF;
 IF result->>'ok'='true' THEN
  SELECT * INTO f FROM public.friendships WHERE id=p_id;
  IF f.id IS NOT NULL AND f.status='pending' THEN
   PERFORM public.push_user_event(f.addressee_id,'friend:resend',jsonb_build_object(
    'id',f.id,'owner',public._push_user_label(f.requester_id),'url','/go/?f='||f.token));
  END IF;
 END IF;
 RETURN result - 'to';
  EXCEPTION WHEN lock_not_available THEN
   IF attempt=1000 THEN RAISE; END IF;
  END;
  PERFORM pg_sleep(.01);
 END LOOP;
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['_push_user_label(uuid)', 'push_user_event(uuid,text,jsonb)', '_push_friendship()',
    '_push_poll_task()', '_push_base_share()', '_push_device_share()', '_push_copy_offer()'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.push_user_event(uuid,text,jsonb) TO service_role;
  END IF;
  -- Diagnostyka z db-read (tylko liczby): odczyt skrzynki bez treści w logach.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    GRANT SELECT ON public.push_outbox TO agent_reader;
  END IF;
END $$;

COMMIT;
