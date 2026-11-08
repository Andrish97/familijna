-- Ocena systemu także od gości (decyzja użytkownika 2026-11-08).
--  * Gość może wystawić i zmienić ocenę (wcześniej K8 w 514 blokował gości);
--    limit komentarza 2000 znaków zostaje.
--  * from_guest: ocena wystawiona z konta gościa -- ustawia ją wyzwalacz
--    (z profiles.is_guest), nie przeglądarka. Widoczne tylko w panelu admina.
--  * Konto gościa jest usuwane po wygaśnięciu (_delete_user_data); ocena gościa
--    zostaje wtedy bez powiązania z kontem (user_id = null) i dalej liczy się
--    do średniej. Ocena zwykłego konta i konta testowego znika z kontem jak dotąd.
--  * get_ratings_admin zwraca dodatkowo is_guest (znacznik „Gość” w panelu).
-- Zgodna wstecz: strony nie czytają nowej kolumny, dotychczasowy zapis działa.

ALTER TABLE public.app_ratings ADD COLUMN IF NOT EXISTS from_guest boolean NOT NULL DEFAULT false;
ALTER TABLE public.app_ratings ALTER COLUMN user_id DROP NOT NULL;

-- Klucz do profilu: przy usunięciu konta user_id -> null; o tym, czy wiersz
-- zostaje, decyduje wyzwalacz app_ratings_after_unlink (poniżej).
ALTER TABLE public.app_ratings DROP CONSTRAINT IF EXISTS app_ratings_user_id_fkey;
ALTER TABLE public.app_ratings ADD CONSTRAINT app_ratings_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Oznaczenie gościa: zawsze z profilu (wartość z przeglądarki jest pomijana).
CREATE OR REPLACE FUNCTION public.app_ratings_set_from_guest() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.user_id IS NULL THEN
    NEW.from_guest := CASE WHEN TG_OP = 'UPDATE' THEN OLD.from_guest ELSE false END;
  ELSE
    NEW.from_guest := coalesce((SELECT p.is_guest FROM public.profiles p WHERE p.id = NEW.user_id), false);
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.app_ratings_set_from_guest() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_ratings_set_from_guest ON public.app_ratings;
CREATE TRIGGER app_ratings_set_from_guest BEFORE INSERT OR UPDATE ON public.app_ratings
  FOR EACH ROW EXECUTE FUNCTION public.app_ratings_set_from_guest();

-- Odłączenie od usuwanego konta: zostaje tylko ocena gościa, który nadal jest
-- gościem (nie zamienił się w konto) i nie jest kontem testowym.
CREATE OR REPLACE FUNCTION public.app_ratings_after_unlink() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_guest boolean;
BEGIN
  SELECT p.is_guest INTO v_guest FROM public.profiles p WHERE p.id = OLD.user_id;
  IF NOT coalesce(v_guest, NEW.from_guest) OR public.is_test_user(OLD.user_id) THEN
    DELETE FROM public.app_ratings WHERE id = NEW.id;
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.app_ratings_after_unlink() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS app_ratings_after_unlink ON public.app_ratings;
CREATE TRIGGER app_ratings_after_unlink AFTER UPDATE OF user_id ON public.app_ratings
  FOR EACH ROW WHEN (OLD.user_id IS NOT NULL AND NEW.user_id IS NULL)
  EXECUTE FUNCTION public.app_ratings_after_unlink();

-- Zapis: każde zalogowane konto (także gość) -- tylko własna ocena.
DROP POLICY IF EXISTS "Users can insert their own rating" ON public.app_ratings;
CREATE POLICY "Users can insert their own rating" ON public.app_ratings FOR INSERT
  WITH CHECK (auth.uid() = user_id AND char_length(coalesce(comment, '')) <= 2000);
DROP POLICY IF EXISTS "Users can update their own rating" ON public.app_ratings;
CREATE POLICY "Users can update their own rating" ON public.app_ratings FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND char_length(coalesce(comment, '')) <= 2000);

-- Lista ocen w panelu admina: dodatkowo is_guest.
DROP FUNCTION IF EXISTS public.get_ratings_admin();
CREATE FUNCTION public.get_ratings_admin() RETURNS TABLE(id uuid, user_id uuid, stars smallint, comment text, created_at timestamp with time zone, username text, email text, is_guest boolean)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public', 'auth' AS $$
  SELECT
    r.id,
    r.user_id,
    r.stars::smallint,
    r.comment,
    r.created_at,
    p.username,
    p.email,
    r.from_guest
  FROM public.app_ratings r
  LEFT JOIN public.profiles p ON p.id = r.user_id
  WHERE NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = r.user_id)
  ORDER BY r.created_at DESC;
$$;
REVOKE ALL ON FUNCTION public.get_ratings_admin() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_ratings_admin() TO service_role;

-- Dotychczasowe oceny: oznaczenie z profilu (goście nie mogli oceniać, więc
-- zwykle bez zmian).
UPDATE public.app_ratings r SET from_guest = true
  FROM public.profiles p WHERE p.id = r.user_id AND p.is_guest AND NOT r.from_guest;
