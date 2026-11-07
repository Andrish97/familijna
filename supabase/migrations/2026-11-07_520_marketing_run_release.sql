-- Oddanie dzierżawy przebiegu Marketingu przy zatrzymaniu usługi (wdrożenie):
-- nowy kontener przejmuje przebieg od razu, bez czekania na wygaśnięcie (120 s).
-- Przebieg zostaje aktywny (status bez zmian). Dodająca.
BEGIN;
CREATE FUNCTION public.mk_run_release(p_run uuid, p_lease uuid, p_verified integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_verified < 0 THEN RAISE EXCEPTION 'mk_run_bad_args'; END IF;
 UPDATE marketing_runs SET verified=greatest(verified,p_verified), lease_until=now()-interval '1 second', updated_at=now()
  WHERE run_id=p_run AND lease=p_lease AND status IN ('running','paused','cancel_requested');
 RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.mk_run_release(uuid,uuid,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mk_run_release(uuid,uuid,integer) TO service_role;
COMMIT;
