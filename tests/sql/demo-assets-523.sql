\set ON_ERROR_STOP 1
-- Test 523: bucket demo-assets publiczny do odczytu, bez polityk zapisu dla użytkowników.
DO $$ BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id='demo-assets' AND public) THEN RAISE EXCEPTION 'bucket_missing'; END IF;
 IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects'
            AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%demo-assets%' AND cmd IN ('INSERT','UPDATE','DELETE','ALL')) THEN
  RAISE EXCEPTION 'user_write_policy_on_demo_assets';
 END IF;
 RAISE NOTICE 'demo-assets-523: OK';
END $$;
