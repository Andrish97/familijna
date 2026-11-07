\set ON_ERROR_STOP 1
-- Test migracji 520: psql -f tests/sql/marketing-run-release-520.sql
BEGIN;
DO $$
DECLARE r uuid:=gen_random_uuid(); l1 uuid:=gen_random_uuid(); l2 uuid:=gen_random_uuid(); j jsonb;
BEGIN
 IF has_function_privilege('anon','mk_run_release(uuid,uuid,integer)','EXECUTE') THEN RAISE EXCEPTION 'exposed'; END IF;
 DELETE FROM marketing_runs;
 PERFORM mk_run_create(r,20);
 PERFORM mk_run_claim(l1,120);
 IF mk_run_release(r,l2,3) THEN RAISE EXCEPTION 'foreign_release'; END IF;
 IF NOT mk_run_release(r,l1,4) THEN RAISE EXCEPTION 'release'; END IF;
 -- Od razu do przejęcia przez nowy proces, z licznikiem i jako wznowienie.
 j := mk_run_claim(l2,120);
 IF j->>'run_id' <> r::text OR (j->>'verified')::int <> 4 OR (j->>'resumed')::int <> 1 OR j->>'status' <> 'running' THEN RAISE EXCEPTION 'claim_after_release %', j; END IF;
 RAISE NOTICE 'marketing-run-release-520: OK';
END $$;
ROLLBACK;
