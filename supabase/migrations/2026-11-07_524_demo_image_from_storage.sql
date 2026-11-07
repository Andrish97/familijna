-- Obraz demo „Obraz”: adres pliku strony (/logos/assets/demo-image.png, migracja 308,
-- także stara domena) → plik w bucket demo-assets (523, wgrany przez
-- familijna-server `supabase demo-image-apply`; ta sama treść, SHA-256 w nazwie).
-- Podmiana we wzorcach, wszystkich logo (także edytowanych — te same bajty) i w
-- historii aktualizacji demo, żeby definicje kopii i wzorców dalej się zgadzały.
-- Przerywa, gdy pliku nie ma w Storage (bez zepsutych obrazów).
BEGIN;
DO $$
DECLARE
 new_url text := 'https://api.familijna.app/storage/v1/object/public/demo-assets/2afc817d09b134d95db6e03d629e4bfd9a714e246dba13fd8b474192d40b39b6.png';
 pat text := 'https?://(www\.)?(familiada\.online|familijna\.app)/(logo-editor|logos?)/assets/demo-image\.png';
BEGIN
 IF NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='demo-assets'
   AND name='2afc817d09b134d95db6e03d629e4bfd9a714e246dba13fd8b474192d40b39b6.png') THEN
  RAISE EXCEPTION 'demo_image_not_uploaded: najpierw familijna-server supabase demo-image-apply';
 END IF;
 UPDATE public.demo_template_data SET payload = regexp_replace(payload::text, pat, new_url, 'g')::jsonb WHERE payload::text ~ pat;
 UPDATE public.user_logos SET payload = regexp_replace(payload::text, pat, new_url, 'g')::jsonb WHERE payload::text ~ pat;
 UPDATE public.admin_demo_updates SET
   old_payload = regexp_replace(old_payload::text, pat, new_url, 'g')::jsonb,
   new_payload = regexp_replace(new_payload::text, pat, new_url, 'g')::jsonb,
   old_definition = regexp_replace(old_definition::text, pat, new_url, 'g')::jsonb
  WHERE old_payload::text ~ pat OR new_payload::text ~ pat OR old_definition::text ~ pat;
 UPDATE public.admin_demo_targets SET expected_definition = regexp_replace(expected_definition::text, pat, new_url, 'g')::jsonb
  WHERE expected_definition::text ~ pat;
END $$;
COMMIT;
