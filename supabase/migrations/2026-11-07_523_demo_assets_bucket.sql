-- Obrazy wzorców demo w Storage (familijna-server/docs/demo-aktualizacja-plan.md):
-- osobny bucket demo-assets, publiczny do odczytu, bez polityk zapisu — pliki wgrywa
-- tylko serwer (rola service_role: Worker panelu przy „Zapisz demo”). Użytkownik
-- edytując swoje logo wgrywa obraz do własnego folderu w user-logos i kasuje tylko
-- tam, więc pliku wzorca nie nadpisze ani nie usunie. Nazwa pliku = SHA-256 treści;
-- pliki nie są nadpisywane (edytowane kopie mogą wskazywać starszą wersję).
BEGIN;
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('demo-assets', 'demo-assets', true, 5242880, ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT (id) DO UPDATE SET public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
COMMIT;
