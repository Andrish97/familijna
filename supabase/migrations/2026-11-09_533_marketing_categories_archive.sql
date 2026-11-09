-- 533: Archiwum kategorii Lead Findera (decyzja użytkownika 2026-11-09).
-- Kategoria zarchiwizowana nie jest przeszukiwana (is_active = false, pilnuje
-- tego ograniczenie) i nie zajmuje listy kategorii w panelu; jej kontakty
-- zostają z kategorią i są widoczne w tabeli jak dotąd. Kategorii z kontaktami
-- nie da się usunąć (kontakty nie zostają bez kategorii) — zamiast tego archiwum.

ALTER TABLE public.marketing_categories ADD COLUMN IF NOT EXISTS archived_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'marketing_categories_archived_inactive') THEN
    ALTER TABLE public.marketing_categories
      ADD CONSTRAINT marketing_categories_archived_inactive CHECK (archived_at IS NULL OR NOT is_active);
  END IF;
END $$;

-- Lista dla panelu: także data archiwizacji (zmiana typu wyniku = DROP + CREATE).
DROP FUNCTION IF EXISTS public.marketing_categories_list();
CREATE FUNCTION public.marketing_categories_list()
RETURNS TABLE (id uuid, name text, is_active boolean, description text, queries text[], pkd text[],
               expanded_at timestamptz, created_at timestamptz, contacts int, archived_at timestamptz)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT k.id, k.name, k.is_active, k.description, k.queries, k.pkd, k.expanded_at, k.created_at,
         (SELECT count(*)::int FROM public.marketing_verified_contacts c WHERE c.category_id = k.id),
         k.archived_at
    FROM public.marketing_categories k
   ORDER BY k.created_at, k.name;
$$;
REVOKE ALL ON FUNCTION public.marketing_categories_list() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_categories_list() TO service_role;

-- Usunięcie kategorii z kontaktami — błąd zamiast odpięcia kontaktów (ON DELETE SET NULL).
CREATE OR REPLACE FUNCTION public.marketing_categories_keep_contacts()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.marketing_verified_contacts c WHERE c.category_id = OLD.id) THEN
    RAISE EXCEPTION 'marketing_category_has_contacts' USING ERRCODE = 'P0001',
      HINT = 'Kategorię z kontaktami można tylko przenieść do archiwum.';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.marketing_categories_keep_contacts() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS marketing_categories_keep_contacts ON public.marketing_categories;
CREATE TRIGGER marketing_categories_keep_contacts BEFORE DELETE ON public.marketing_categories
  FOR EACH ROW EXECUTE FUNCTION public.marketing_categories_keep_contacts();
