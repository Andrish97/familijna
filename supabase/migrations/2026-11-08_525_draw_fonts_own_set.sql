-- Własny zestaw czcionek edytora rysunku (decyzja użytkownika 2026-11-08):
-- czcionki systemowe usunięte z listy, rysunki dostają najbliższy krój
-- z zestawu (web/shared/js/core/draw-fonts.js, ta sama tabela co
-- normalizeDrawFont). Zmienia się tylko nazwa czcionki obiektu tekstu
-- w scenie (fabricData); kropki logo (bits_b64) bez zmian — przy kolejnej
-- edycji przelicza je edytor. Wzorce demo, wszystkie loga i historia
-- aktualizacji demo, żeby definicje kopii i wzorców dalej się zgadzały.
-- Pozostałe nazwy spoza zestawu -> Roboto. Test: tests/sql/draw-fonts-525.sql.
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.draw_fonts_fix(p jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE
 t text := p::text;
 r record;
BEGIN
 IF p IS NULL OR position('"fontFamily"' in t) = 0 THEN RETURN p; END IF;
 FOR r IN SELECT * FROM (VALUES
  ('system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif', 'Roboto'),
  ('Arial, Helvetica, sans-serif', 'Roboto'),
  ('Helvetica Neue, Helvetica, Arial, sans-serif', 'Roboto'),
  ('Segoe UI, SegoeUI, Arial, sans-serif', 'Roboto'),
  ('Roboto, Segoe UI, Arial, sans-serif', 'Roboto'),
  ('Calibri, Candara, Segoe UI, sans-serif', 'Roboto'),
  ('Candara, Calibri, Segoe UI, sans-serif', 'Roboto'),
  ('''Trebuchet MS'', Trebuchet, Arial, sans-serif', 'Roboto'),
  ('Verdana, Geneva, sans-serif', 'Roboto'),
  ('Tahoma, Verdana, sans-serif', 'Roboto'),
  ('''Times New Roman'', Times, serif', 'Merriweather'),
  ('Georgia, ''Times New Roman'', serif', 'Merriweather'),
  ('Garamond, ''Palatino Linotype'', serif', 'Merriweather'),
  ('''Palatino Linotype'', Palatino, serif', 'Merriweather'),
  ('''Book Antiqua'', Palatino, serif', 'Merriweather'),
  ('Cambria, Georgia, serif', 'Merriweather'),
  ('Didot, ''Bodoni MT'', serif', 'Playfair Display'),
  ('''Bodoni MT'', Didot, serif', 'Playfair Display'),
  ('''Courier New'', Courier, monospace', 'JetBrains Mono'),
  ('Consolas, ''Courier New'', monospace', 'JetBrains Mono'),
  ('''Lucida Console'', Monaco, monospace', 'JetBrains Mono'),
  ('''Cascadia Mono'', Consolas, monospace', 'JetBrains Mono'),
  ('Monaco, Consolas, monospace', 'JetBrains Mono'),
  ('''Arial Black'', Arial, sans-serif', 'Montserrat'),
  ('Impact, Haettenschweiler, ''Arial Narrow Bold'', sans-serif', 'Oswald'),
  ('Haettenschweiler, Impact, sans-serif', 'Oswald'),
  ('Rockwell, ''Rockwell Extra Bold'', serif', 'Roboto Slab'),
  ('''Cooper Black'', ''Rockwell Extra Bold'', serif', 'Roboto Slab'),
  ('''Comic Sans MS'', ''Arial Rounded MT Bold'', cursive', 'Caveat'),
  ('''Arial Rounded MT Bold'', Arial, sans-serif', 'Nunito'),
  ('''Segoe Script'', ''Brush Script MT'', cursive', 'Marck Script'),
  ('''Brush Script MT'', ''Segoe Script'', cursive', 'Pacifico'),
  ('''Lucida Handwriting'', ''Segoe Script'', cursive', 'Marck Script'),
  ('''Apple Chancery'', ''Segoe Script'', cursive', 'Marck Script'),
  ('''Snell Roundhand'', ''Apple Chancery'', cursive', 'Marck Script'),
  ('Papyrus, ''Copperplate Gothic'', fantasy', 'Kurale'),
  ('''Copperplate Gothic'', Papyrus, fantasy', 'Yeseva One'),
  ('''Franklin Gothic Medium'', ''Arial Narrow'', Arial, sans-serif', 'Roboto'),
  ('''Gill Sans'', ''Trebuchet MS'', sans-serif', 'Roboto'),
  ('Optima, Candara, Segoe UI, sans-serif', 'Roboto'),
  ('Futura, ''Century Gothic'', Arial, sans-serif', 'Montserrat'),
  ('''Century Gothic'', Futura, Arial, sans-serif', 'Montserrat'),
  ('Symbol', 'Roboto'),
  ('Wingdings', 'Roboto'),
  ('Webdings', 'Roboto')
 ) AS m(old_family, new_family) LOOP
  t := replace(t, '"fontFamily": ' || to_jsonb(r.old_family)::text, '"fontFamily": ' || to_jsonb(r.new_family)::text);
 END LOOP;
 t := regexp_replace(t, '"fontFamily": "(?!(?:Roboto|Montserrat|Rubik|Nunito|Comfortaa|Exo 2|Jura|Tektur|Oswald|Unbounded|Russo One|Dela Gothic One|Rubik Mono One|Climate Crisis|Rubik Bubbles|Ruslan Display|Merriweather|Playfair Display|Roboto Slab|Yeseva One|Kurale|Poiret One|Lobster|Pacifico|Caveat|Marck Script|Press Start 2P|Tiny5|Handjet|JetBrains Mono)")(?:[^"\\]|\\.)*"', '"fontFamily": "Roboto"', 'g');
 RETURN t::jsonb;
END $f$;

-- Niezauważalnie: bez zmiany daty edycji (kolejność list) i bez blokady
-- loga czekającego jako kopia u znajomego (to ta sama treść).
ALTER TABLE public.user_logos DISABLE TRIGGER trg_user_logos_touch;
ALTER TABLE public.user_logos DISABLE TRIGGER copy_pending_logo;
UPDATE public.user_logos SET payload = pg_temp.draw_fonts_fix(payload)
 WHERE payload::text LIKE '%"fontFamily"%' AND payload IS DISTINCT FROM pg_temp.draw_fonts_fix(payload);
ALTER TABLE public.user_logos ENABLE TRIGGER trg_user_logos_touch;
ALTER TABLE public.user_logos ENABLE TRIGGER copy_pending_logo;
UPDATE public.demo_template_data SET payload = pg_temp.draw_fonts_fix(payload)
 WHERE payload::text LIKE '%"fontFamily"%' AND payload IS DISTINCT FROM pg_temp.draw_fonts_fix(payload);
UPDATE public.admin_demo_updates SET
  old_payload = pg_temp.draw_fonts_fix(old_payload),
  new_payload = pg_temp.draw_fonts_fix(new_payload),
  old_definition = pg_temp.draw_fonts_fix(old_definition)
 WHERE old_payload::text LIKE '%"fontFamily"%' OR new_payload::text LIKE '%"fontFamily"%' OR old_definition::text LIKE '%"fontFamily"%';
UPDATE public.admin_demo_targets SET expected_definition = pg_temp.draw_fonts_fix(expected_definition)
 WHERE expected_definition::text LIKE '%"fontFamily"%';
COMMIT;
