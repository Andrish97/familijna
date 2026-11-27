-- 545: odczyt dla roli agent_reader (414) -- liczby do diagnozy prośby o ocenę
-- systemu (ile ocen, od kiedy, ilu powracających użytkowników mogło ją zobaczyć).
-- Tylko kolumny bez treści: bez komentarza ocen. site_activity_hours to godzina
-- i UUID konta (bez nazw i e-maili).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'agent_reader') THEN
    GRANT SELECT (id, user_id, stars, created_at, from_guest) ON public.app_ratings TO agent_reader;
    GRANT SELECT ON public.site_activity_hours TO agent_reader;
  END IF;
END $$;
