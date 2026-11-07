\set ON_ERROR_STOP 1
-- Test migracji 518 (wspólne bramki usług): psql -f tests/sql/service-slots-518.sql
BEGIN;
DO $$
DECLARE a uuid; b uuid; c uuid; d uuid; left_s double precision;
BEGIN
 IF has_function_privilege('anon','svc_slot_acquire(text,integer,text,integer)','EXECUTE')
    OR has_function_privilege('authenticated','svc_slot_acquire(text,integer,text,integer)','EXECUTE')
    OR has_table_privilege('authenticated','service_slots','SELECT') THEN
  RAISE EXCEPTION 'svc_exposed';
 END IF;
 IF NOT has_function_privilege('service_role','svc_slot_acquire(text,integer,text,integer)','EXECUTE') THEN
  RAISE EXCEPTION 'svc_service_role_missing';
 END IF;

 -- Pojemność 2: marketing bierze dwa miejsca (nikt inny nie czeka), trzecie odmowa.
 a := svc_slot_acquire('search',2,'marketing',60);
 b := svc_slot_acquire('search',2,'marketing',60);
 IF a IS NULL OR b IS NULL THEN RAISE EXCEPTION 'capacity_not_used'; END IF;
 IF svc_slot_acquire('search',2,'marketing',60) IS NOT NULL THEN RAISE EXCEPTION 'capacity_exceeded'; END IF;
 -- Pytania czekają (pełno) — zapisane jako czekające.
 IF svc_slot_acquire('search',2,'questions',60) IS NOT NULL THEN RAISE EXCEPTION 'capacity_exceeded_q'; END IF;
 PERFORM svc_slot_release(a);
 -- Zwolnione miejsce: marketing brał ostatnio, a pytania czekają → marketing ustępuje.
 IF svc_slot_acquire('search',2,'marketing',60) IS NOT NULL THEN RAISE EXCEPTION 'not_fair'; END IF;
 c := svc_slot_acquire('search',2,'questions',60);
 IF c IS NULL THEN RAISE EXCEPTION 'waiting_owner_starved'; END IF;
 -- Teraz pytania brały ostatnio; po zwolnieniu marketing (czekał) ma pierwszeństwo.
 PERFORM svc_slot_release(b);
 IF svc_slot_acquire('search',2,'questions',60) IS NOT NULL THEN RAISE EXCEPTION 'not_fair_2'; END IF;
 d := svc_slot_acquire('search',2,'marketing',60);
 IF d IS NULL THEN RAISE EXCEPTION 'marketing_starved'; END IF;
 PERFORM svc_slot_release(c); PERFORM svc_slot_release(d);

 -- Zasoby niezależne: AI pojemność 1.
 a := svc_slot_acquire('ai',1,'questions',60);
 IF a IS NULL OR svc_slot_acquire('ai',1,'questions',60) IS NOT NULL THEN RAISE EXCEPTION 'ai_capacity'; END IF;
 -- Wygasła dzierżawa (proces padł) zwalnia miejsce; przedłużenie po wygaśnięciu — false.
 UPDATE service_slots SET lease_until=now()-interval '1 second' WHERE holder=a;
 IF svc_slot_renew(a,60) THEN RAISE EXCEPTION 'renew_expired'; END IF;
 DELETE FROM service_slot_waits;
 b := svc_slot_acquire('ai',1,'marketing',60);
 IF b IS NULL THEN RAISE EXCEPTION 'expired_not_reclaimed'; END IF;
 IF NOT svc_slot_renew(b,120) THEN RAISE EXCEPTION 'renew_failed'; END IF;
 IF NOT svc_slot_release(b) OR svc_slot_release(b) THEN RAISE EXCEPTION 'release'; END IF;

 -- Cooldown: wydłuża, nie skraca.
 IF svc_cooldown_left('ai') <> 0 THEN RAISE EXCEPTION 'cooldown_initial'; END IF;
 PERFORM svc_cooldown_set('ai',300);
 PERFORM svc_cooldown_set('ai',30);
 left_s := svc_cooldown_left('ai');
 IF left_s < 299 OR left_s > 300 THEN RAISE EXCEPTION 'cooldown_value %', left_s; END IF;

 -- Złe argumenty.
 BEGIN PERFORM svc_slot_acquire('search',2,'evil',60); RAISE EXCEPTION 'bad_owner_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'svc_slot_bad_args' THEN RAISE; END IF; END;
 BEGIN PERFORM svc_slot_acquire('disk',2,'marketing',60); RAISE EXCEPTION 'bad_resource_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'svc_slot_bad_args' THEN RAISE; END IF; END;
 RAISE NOTICE 'service-slots-518: OK';
END $$;
ROLLBACK;
