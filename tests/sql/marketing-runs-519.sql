\set ON_ERROR_STOP 1
-- Test migracji 519 (przebieg Marketingu w bazie): psql -f tests/sql/marketing-runs-519.sql
BEGIN;
DO $$
DECLARE r1 uuid:=gen_random_uuid(); r2 uuid:=gen_random_uuid(); l1 uuid:=gen_random_uuid(); l2 uuid:=gen_random_uuid(); j jsonb;
BEGIN
 IF has_function_privilege('anon','mk_run_create(uuid,integer)','EXECUTE')
    OR has_function_privilege('authenticated','mk_run_command(uuid,text)','EXECUTE')
    OR has_table_privilege('authenticated','marketing_runs','SELECT') THEN RAISE EXCEPTION 'mk_exposed'; END IF;
 DELETE FROM marketing_runs;
 IF mk_run_create(r1,50) IS NULL THEN RAISE EXCEPTION 'create'; END IF;
 IF mk_run_create(r2,50) IS NOT NULL THEN RAISE EXCEPTION 'two_active'; END IF;
 -- Proces A przejmuje; B nie może, dopóki dzierżawa A ważna.
 j := mk_run_claim(l1,120);
 IF j->>'run_id' <> r1::text OR (j->>'resumed')::int <> 0 THEN RAISE EXCEPTION 'claim %', j; END IF;
 IF mk_run_claim(l2,120) IS NOT NULL THEN RAISE EXCEPTION 'double_claim'; END IF;
 IF mk_run_heartbeat(r1,l1,7,120) <> 'running' THEN RAISE EXCEPTION 'heartbeat'; END IF;
 -- Panel: pauza → puls widzi pauzę; wznowienie.
 IF mk_run_command(r1,'pause') <> 'paused' OR mk_run_heartbeat(r1,l1,7,120) <> 'paused' THEN RAISE EXCEPTION 'pause'; END IF;
 IF mk_run_command(r1,'pause') IS NOT NULL THEN RAISE EXCEPTION 'pause_twice'; END IF;
 IF mk_run_command(r1,'resume') <> 'running' THEN RAISE EXCEPTION 'resume'; END IF;
 -- Restart: dzierżawa A wygasła → B przejmuje z zachowanym licznikiem; puls A odrzucony.
 UPDATE marketing_runs SET lease_until=now()-interval '1 second' WHERE run_id=r1;
 j := mk_run_claim(l2,120);
 IF j->>'run_id' <> r1::text OR (j->>'verified')::int <> 7 OR (j->>'resumed')::int <> 1 THEN RAISE EXCEPTION 'resume_claim %', j; END IF;
 IF mk_run_heartbeat(r1,l1,9,120) IS NOT NULL THEN RAISE EXCEPTION 'stale_owner_heartbeat'; END IF;
 IF mk_run_finish(r1,l1,'completed',9) THEN RAISE EXCEPTION 'stale_owner_finish'; END IF;
 -- Licznik nie maleje.
 PERFORM mk_run_heartbeat(r1,l2,3,120);
 IF (SELECT verified FROM marketing_runs WHERE run_id=r1) <> 7 THEN RAISE EXCEPTION 'verified_decreased'; END IF;
 -- Anulowanie z panelu → puls widzi cancel_requested → koniec.
 IF mk_run_command(r1,'cancel') <> 'cancel_requested' OR mk_run_heartbeat(r1,l2,8,120) <> 'cancel_requested' THEN RAISE EXCEPTION 'cancel'; END IF;
 IF NOT mk_run_finish(r1,l2,'cancelled',8) THEN RAISE EXCEPTION 'finish'; END IF;
 IF mk_run_active() IS NOT NULL OR mk_run_claim(l1,120) IS NOT NULL THEN RAISE EXCEPTION 'finished_still_active'; END IF;
 -- Po zakończeniu można zacząć nowy.
 IF mk_run_create(r2,10) IS NULL OR (mk_run_active()->>'run_id') <> r2::text THEN RAISE EXCEPTION 'new_after_finish'; END IF;
 BEGIN PERFORM mk_run_create(gen_random_uuid(),0); RAISE EXCEPTION 'bad_target';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'mk_run_bad_args' THEN RAISE; END IF; END;
 RAISE NOTICE 'marketing-runs-519: OK';
END $$;
ROLLBACK;
