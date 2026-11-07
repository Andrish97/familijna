-- Wspólne bramki usług wyszukiwania (plan: familijna-server/docs/wyszukiwarka-podzial-plan.md, etap 1).
-- Po podziale Lead Findera na dwa kontenery (kontakty, pytania) limit „2 wyszukiwania
-- SearXNG naraz” i „1 wywołanie DeepSeeka naraz” musi działać ponad procesami.
-- Dzierżawa z wygasaniem: proces, który padnie, zwalnia miejsce po TTL.
-- Przemienny przydział: gdy czeka inna usługa, ta, która brała ostatnio, ustępuje.
-- Migracja dodająca — działający kod (FairGate w pamięci) jej nie używa.
BEGIN;

CREATE TABLE public.service_slots (
  holder uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL CHECK (resource IN ('search','ai')),
  owner text NOT NULL CHECK (owner IN ('marketing','questions')),
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX service_slots_resource_idx ON public.service_slots(resource, lease_until);

CREATE TABLE public.service_slot_waits (
  resource text NOT NULL,
  owner text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (resource, owner)
);

CREATE TABLE public.service_resource_state (
  resource text PRIMARY KEY CHECK (resource IN ('search','ai')),
  last_owner text,
  cooldown_until timestamptz
);

-- Zwraca identyfikator dzierżawy albo NULL (brak miejsca / kolej innej usługi).
CREATE FUNCTION public.svc_slot_acquire(p_resource text, p_capacity integer, p_owner text, p_ttl_s integer DEFAULT 180)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE active integer; last text; h uuid;
BEGIN
 IF p_resource NOT IN ('search','ai') OR p_owner NOT IN ('marketing','questions')
    OR p_capacity < 1 OR p_capacity > 8 OR p_ttl_s < 10 OR p_ttl_s > 900 THEN
  RAISE EXCEPTION 'svc_slot_bad_args';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('svc-slot:'||p_resource,0));
 DELETE FROM service_slots WHERE resource=p_resource AND lease_until < now();
 DELETE FROM service_slot_waits WHERE resource=p_resource AND seen_at < now() - interval '10 seconds';
 INSERT INTO service_slot_waits(resource,owner,seen_at) VALUES(p_resource,p_owner,now())
  ON CONFLICT(resource,owner) DO UPDATE SET seen_at=excluded.seen_at;
 SELECT count(*) INTO active FROM service_slots WHERE resource=p_resource;
 IF active >= p_capacity THEN RETURN NULL; END IF;
 SELECT last_owner INTO last FROM service_resource_state WHERE resource=p_resource;
 IF last = p_owner AND EXISTS (SELECT 1 FROM service_slot_waits WHERE resource=p_resource AND owner<>p_owner) THEN
  RETURN NULL;
 END IF;
 INSERT INTO service_slots(resource,owner,lease_until) VALUES(p_resource,p_owner,now()+make_interval(secs=>p_ttl_s))
  RETURNING holder INTO h;
 INSERT INTO service_resource_state(resource,last_owner) VALUES(p_resource,p_owner)
  ON CONFLICT(resource) DO UPDATE SET last_owner=excluded.last_owner;
 DELETE FROM service_slot_waits WHERE resource=p_resource AND owner=p_owner;
 RETURN h;
END $$;

-- Przedłużenie trwającej dzierżawy (długie wywołanie); false = dzierżawa wygasła.
CREATE FUNCTION public.svc_slot_renew(p_holder uuid, p_ttl_s integer DEFAULT 180)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_ttl_s < 10 OR p_ttl_s > 900 THEN RAISE EXCEPTION 'svc_slot_bad_args'; END IF;
 UPDATE service_slots SET lease_until=now()+make_interval(secs=>p_ttl_s) WHERE holder=p_holder AND lease_until >= now();
 RETURN FOUND;
END $$;

CREATE FUNCTION public.svc_slot_release(p_holder uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 DELETE FROM service_slots WHERE holder=p_holder;
 RETURN FOUND;
END $$;

-- Wspólny cooldown dostawcy (np. AI po błędzie): wydłuża, nigdy nie skraca.
CREATE FUNCTION public.svc_cooldown_set(p_resource text, p_seconds integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_resource NOT IN ('search','ai') OR p_seconds < 1 OR p_seconds > 3600 THEN RAISE EXCEPTION 'svc_slot_bad_args'; END IF;
 INSERT INTO service_resource_state(resource,cooldown_until) VALUES(p_resource,now()+make_interval(secs=>p_seconds))
  ON CONFLICT(resource) DO UPDATE SET cooldown_until=greatest(coalesce(service_resource_state.cooldown_until,now()),excluded.cooldown_until);
 RETURN true;
END $$;

-- Ile sekund cooldownu zostało (0 = brak).
CREATE FUNCTION public.svc_cooldown_left(p_resource text)
RETURNS double precision LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT greatest(0, coalesce(extract(epoch FROM (SELECT cooldown_until FROM service_resource_state WHERE resource=p_resource) - now()), 0))::double precision
$$;

DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN
 ('service_slots','service_slot_waits','service_resource_state') LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',obj.tablename);
  EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC,anon,authenticated',obj.tablename);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',obj.tablename);
 END LOOP;
 FOR obj IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'svc\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',obj.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',obj.signature);
 END LOOP;
END $$;
COMMIT;
