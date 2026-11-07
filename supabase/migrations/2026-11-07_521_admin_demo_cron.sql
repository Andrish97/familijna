-- Aktualizacje kopii demo bez procesu na serwerze (decyzja właściciela 2026-11-07,
-- familijna-server/docs/wyszukiwarka-podzial-plan.md): kolejkę admin_demo_targets
-- przetwarza procedura w bazie uruchamiana przez pg_cron co minutę. Każda pozycja
-- zatwierdzana osobno (COMMIT) — blokady materiałów użytkowników trwają krótko.
-- Dotąd robiła to pętla w usłudze Lead Finder (admin_demo_apply_next co 0,2–3 s);
-- usługa przestaje ją uruchamiać w tym samym wdrożeniu. Oba naraz są bezpieczne
-- (FOR UPDATE SKIP LOCKED w admin_demo_apply_next).
BEGIN;

CREATE PROCEDURE public.admin_demo_run_queue(p_seconds integer DEFAULT 50)
-- Bez SECURITY DEFINER i SET: Postgres zabrania wtedy COMMIT w procedurze.
-- Wywołuje ją tylko pg_cron (właściciel bazy); nazwy w pełni kwalifikowane.
LANGUAGE plpgsql AS $$
DECLARE started timestamptz := pg_catalog.clock_timestamp(); r jsonb;
BEGIN
 IF p_seconds < 1 OR p_seconds > 55 THEN RAISE EXCEPTION 'admin_demo_bad_args'; END IF;
 LOOP
  r := public.admin_demo_apply_next();
  COMMIT;
  EXIT WHEN r IS NULL OR pg_catalog.clock_timestamp() - started > pg_catalog.make_interval(secs => p_seconds);
 END LOOP;
END $$;

REVOKE ALL ON PROCEDURE public.admin_demo_run_queue(integer) FROM PUBLIC, anon, authenticated;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='familijna_admin_demo_queue') THEN
   PERFORM cron.unschedule('familijna_admin_demo_queue');
  END IF;
  PERFORM cron.schedule('familijna_admin_demo_queue', '* * * * *', 'CALL public.admin_demo_run_queue(50)');
 END IF;
END $$;
COMMIT;
