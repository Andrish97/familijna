-- 532: litera „W” w logo napisowych bez dziury (zgłoszenie użytkownika 2026-11-08).
-- Font 3x10 (web/shared/fonts/display/font_3x10.json) miał w nóżkach „W”
-- znak ▇ (blok 7/8 — górny rząd punktów zgaszony), więc w literze była
-- pozioma dziura. Font poprawiony na „█ █”; ta migracja poprawia zapisane
-- logo: dokładnie wzór starego „W” (▇ ▇ nad ◤Ѵ◥ w tych samych kolumnach) we
-- wszystkich warstwach GLYPH_30x10 — logo użytkowników i szablony logo dla
-- nowych kont. Inne znaki bez zmian.
--   * pomijane logo w ofertach kopii w toku (wyzwalacz copy_pending_logo,
--     skrót zawartości oferty) — liczba w logu migracji;
--   * data zmiany logo zostaje (bez trg_user_logos_touch) — kolejność listy
--     „ostatnio zmienione” się nie zmienia.
-- Test: docs/sql/test-logo-font-w-532.sql.

CREATE FUNCTION pg_temp.logo_fix_w(p_rows jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r text[]; y int; x int; nx int; n int;
BEGIN
  IF jsonb_typeof(p_rows) IS DISTINCT FROM 'array' THEN RETURN p_rows; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_rows) e WHERE jsonb_typeof(e) <> 'string') THEN RETURN p_rows; END IF;
  SELECT array_agg(v ORDER BY o) INTO r FROM jsonb_array_elements_text(p_rows) WITH ORDINALITY AS t(v, o);
  n := coalesce(array_length(r, 1), 0);
  FOR y IN 1 .. n - 1 LOOP
    x := strpos(r[y], '▇ ▇');
    WHILE x > 0 LOOP
      IF substr(r[y + 1], x, 3) = '◤Ѵ◥' THEN r[y] := overlay(r[y] PLACING '█ █' FROM x FOR 3); END IF;
      nx := strpos(substr(r[y], x + 1), '▇ ▇');
      x := CASE WHEN nx = 0 THEN 0 ELSE x + nx END;
    END LOOP;
  END LOOP;
  RETURN CASE WHEN n = 0 THEN p_rows ELSE to_jsonb(r) END;
END $$;

CREATE FUNCTION pg_temp.logo_fix_w_layers(p_layers jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(p_layers) IS DISTINCT FROM 'array' THEN p_layers ELSE coalesce((
    SELECT jsonb_agg(CASE WHEN jsonb_typeof(l) = 'object' AND l ? 'rows'
                          THEN jsonb_set(l, '{rows}', pg_temp.logo_fix_w(l -> 'rows')) ELSE l END ORDER BY o)
    FROM jsonb_array_elements(p_layers) WITH ORDINALITY AS t(l, o)), p_layers) END
$$;

ALTER TABLE public.user_logos DISABLE TRIGGER trg_user_logos_touch;

DO $$
DECLARE v_fixed int; v_skipped int; v_demo int;
BEGIN
  SELECT count(*) INTO v_skipped FROM public.user_logos l
   WHERE l.type = 'GLYPH_30x10' AND (l.payload -> 'layers')::text LIKE '%▇ ▇%'
     AND pg_temp.logo_fix_w_layers(l.payload -> 'layers') <> l.payload -> 'layers'
     AND EXISTS (SELECT 1 FROM public.resource_copy_offers o WHERE o.status = 'pending' AND o.logo_id = l.id);

  UPDATE public.user_logos l
     SET payload = jsonb_set(l.payload, '{layers}', pg_temp.logo_fix_w_layers(l.payload -> 'layers'))
   WHERE l.type = 'GLYPH_30x10' AND (l.payload -> 'layers')::text LIKE '%▇ ▇%'
     AND pg_temp.logo_fix_w_layers(l.payload -> 'layers') <> l.payload -> 'layers'
     AND NOT EXISTS (SELECT 1 FROM public.resource_copy_offers o WHERE o.status = 'pending' AND o.logo_id = l.id);
  GET DIAGNOSTICS v_fixed = ROW_COUNT;

  UPDATE public.demo_template_data d
     SET payload = jsonb_set(d.payload, '{payload,layers}', pg_temp.logo_fix_w_layers(d.payload #> '{payload,layers}'))
   WHERE d.slot LIKE 'logo%' AND (d.payload #> '{payload,layers}')::text LIKE '%▇ ▇%'
     AND pg_temp.logo_fix_w_layers(d.payload #> '{payload,layers}') <> d.payload #> '{payload,layers}';
  GET DIAGNOSTICS v_demo = ROW_COUNT;

  RAISE NOTICE '532 logo W: poprawione logo %, pominięte (oferta kopii w toku) %, szablony dla nowych kont %', v_fixed, v_skipped, v_demo;
END $$;

ALTER TABLE public.user_logos ENABLE TRIGGER trg_user_logos_touch;
