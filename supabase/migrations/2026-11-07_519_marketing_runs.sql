-- Przebieg wyszukiwania kontaktów (Marketing) w bazie — przeżywa restart usługi
-- (plan: familijna-server/docs/wyszukiwarka-podzial-plan.md, etap 2).
-- Dziś stan przebiegu jest tylko w pamięci procesu; wdrożenie go przerywało.
-- Dzierżawa z wygasaniem: po restarcie nowy proces przejmuje przerwany przebieg.
-- Migracja dodająca — działający kod jej nie używa.
BEGIN;

CREATE TABLE public.marketing_runs (
  run_id uuid PRIMARY KEY,
  target integer NOT NULL CHECK (target BETWEEN 1 AND 1000),
  verified integer NOT NULL DEFAULT 0 CHECK (verified >= 0),
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running','paused','cancel_requested','completed','cancelled','error')),
  lease uuid,
  lease_until timestamptz,
  resumed integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
-- Najwyżej jeden przebieg aktywny naraz.
CREATE UNIQUE INDEX marketing_runs_one_active ON public.marketing_runs ((true))
  WHERE status IN ('running','paused','cancel_requested');

-- Nowy przebieg; NULL, gdy inny jest aktywny.
CREATE FUNCTION public.mk_run_create(p_run uuid, p_target integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r marketing_runs;
BEGIN
 IF p_target < 1 OR p_target > 1000 THEN RAISE EXCEPTION 'mk_run_bad_args'; END IF;
 BEGIN
  INSERT INTO marketing_runs(run_id,target) VALUES(p_run,p_target) RETURNING * INTO r;
 EXCEPTION WHEN unique_violation THEN RETURN NULL;
 END;
 RETURN to_jsonb(r)-'lease';
END $$;

-- Przejęcie aktywnego przebiegu bez ważnej dzierżawy (start albo po restarcie).
CREATE FUNCTION public.mk_run_claim(p_lease uuid, p_ttl_s integer DEFAULT 120)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r marketing_runs;
BEGIN
 IF p_ttl_s < 30 OR p_ttl_s > 900 THEN RAISE EXCEPTION 'mk_run_bad_args'; END IF;
 SELECT * INTO r FROM marketing_runs WHERE status IN ('running','paused','cancel_requested')
  AND (lease_until IS NULL OR lease_until < now()) FOR UPDATE SKIP LOCKED LIMIT 1;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE marketing_runs SET lease=p_lease, lease_until=now()+make_interval(secs=>p_ttl_s),
  resumed=resumed+CASE WHEN r.lease IS NULL THEN 0 ELSE 1 END, updated_at=now()
  WHERE run_id=r.run_id RETURNING * INTO r;
 RETURN to_jsonb(r)-'lease';
END $$;

-- Puls właściciela dzierżawy: zapisuje licznik, zwraca status z bazy
-- (pauza / anulowanie z panelu); NULL = dzierżawa utracona (przejął inny proces).
CREATE FUNCTION public.mk_run_heartbeat(p_run uuid, p_lease uuid, p_verified integer, p_ttl_s integer DEFAULT 120)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE st text;
BEGIN
 IF p_ttl_s < 30 OR p_ttl_s > 900 OR p_verified < 0 THEN RAISE EXCEPTION 'mk_run_bad_args'; END IF;
 UPDATE marketing_runs SET verified=greatest(verified,p_verified), lease_until=now()+make_interval(secs=>p_ttl_s), updated_at=now()
  WHERE run_id=p_run AND lease=p_lease AND status IN ('running','paused','cancel_requested')
  RETURNING status INTO st;
 RETURN st;
END $$;

-- Polecenie z panelu: pause | resume | cancel. Zwraca nowy status albo NULL.
CREATE FUNCTION public.mk_run_command(p_run uuid, p_command text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE st text;
BEGIN
 UPDATE marketing_runs SET status=CASE p_command
   WHEN 'pause' THEN 'paused' WHEN 'resume' THEN 'running' WHEN 'cancel' THEN 'cancel_requested' END,
  updated_at=now()
  WHERE run_id=p_run AND (
   (p_command='pause' AND status='running') OR
   (p_command='resume' AND status='paused') OR
   (p_command='cancel' AND status IN ('running','paused')))
  RETURNING status INTO st;
 RETURN st;
END $$;

-- Koniec przebiegu (tylko właściciel dzierżawy).
CREATE FUNCTION public.mk_run_finish(p_run uuid, p_lease uuid, p_status text, p_verified integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_status NOT IN ('completed','cancelled','error') OR p_verified < 0 THEN RAISE EXCEPTION 'mk_run_bad_args'; END IF;
 UPDATE marketing_runs SET status=p_status, verified=greatest(verified,p_verified), lease=NULL, lease_until=NULL,
  finished_at=now(), updated_at=now()
  WHERE run_id=p_run AND lease=p_lease AND status IN ('running','paused','cancel_requested');
 RETURN FOUND;
END $$;

-- Aktywny przebieg (do stanu w panelu, gdy proces dopiero go przejmuje).
CREATE FUNCTION public.mk_run_active()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT to_jsonb(r)-'lease' FROM marketing_runs r WHERE status IN ('running','paused','cancel_requested') LIMIT 1
$$;

ALTER TABLE public.marketing_runs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_runs FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.marketing_runs TO service_role;
DO $$ DECLARE obj record; BEGIN
 FOR obj IN SELECT oid::regprocedure AS signature FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'mk\_run\_%' ESCAPE '\' LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC,anon,authenticated',obj.signature);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',obj.signature);
 END LOOP;
END $$;
COMMIT;
