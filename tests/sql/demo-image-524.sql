-- Test 524 na bazie tymczasowej (sql-gate), uruchamiany z katalogu repo:
--   psql -f tests/sql/demo-image-524.sql
-- 1) bez pliku w demo-assets migracja odmawia i nic nie zmienia; 2) z plikiem — adresy podmienione.
\set ON_ERROR_STOP 1
INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES('00000000-0000-4000-8000-0000000524aa','t524@example.invalid','{}');
INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','logo_image','{"kind":"PIX","name":"Obraz","payload":{"source":{"mode":"IMAGE","imageUrl":"https://www.familiada.online/logos/assets/demo-image.png"}}}')
 ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
INSERT INTO user_logos(id,user_id,name,type,payload,is_demo) VALUES('00000000-0000-4000-8000-0000000524bb','00000000-0000-4000-8000-0000000524aa','Obraz','PIX_150x70',
 '{"source":{"mode":"IMAGE","imageUrl":"https://www.familijna.app/logos/assets/demo-image.png"}}',true);
\set ON_ERROR_STOP 0
\i supabase/migrations/2026-11-07_524_demo_image_from_storage.sql
ROLLBACK;
\set ON_ERROR_STOP 1
DO $$ BEGIN
 IF (SELECT payload::text FROM demo_template_data WHERE lang='pl' AND slot='logo_image') NOT LIKE '%www.familiada.online/logos/assets/demo-image.png%' THEN RAISE EXCEPTION 'changed_without_file'; END IF;
END $$;
INSERT INTO storage.objects(bucket_id,name) VALUES('demo-assets','2afc817d09b134d95db6e03d629e4bfd9a714e246dba13fd8b474192d40b39b6.png');
\i supabase/migrations/2026-11-07_524_demo_image_from_storage.sql
DO $$ DECLARE u text := 'https://api.familijna.app/storage/v1/object/public/demo-assets/2afc817d09b134d95db6e03d629e4bfd9a714e246dba13fd8b474192d40b39b6.png'; BEGIN
 IF (SELECT payload#>>'{payload,source,imageUrl}' FROM demo_template_data WHERE lang='pl' AND slot='logo_image') <> u THEN RAISE EXCEPTION 'template_not_moved'; END IF;
 IF (SELECT payload#>>'{source,imageUrl}' FROM user_logos WHERE id='00000000-0000-4000-8000-0000000524bb') <> u THEN RAISE EXCEPTION 'copy_not_moved'; END IF;
 IF EXISTS (SELECT 1 FROM user_logos WHERE payload::text ~ '/logos?/assets/') THEN RAISE EXCEPTION 'site_url_left'; END IF;
 RAISE NOTICE 'demo-image-524: OK';
END $$;
DELETE FROM user_logos WHERE id='00000000-0000-4000-8000-0000000524bb';
DELETE FROM auth.users WHERE id='00000000-0000-4000-8000-0000000524aa';
DELETE FROM storage.objects WHERE bucket_id='demo-assets';
