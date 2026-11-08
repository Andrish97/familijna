\set ON_ERROR_STOP 1
-- Test migracji 525 (własny zestaw czcionek rysunku): po migracji żaden
-- obiekt tekstu w logach, wzorcach demo i historii demo nie ma czcionki
-- spoza zestawu (web/shared/js/core/draw-fonts.js). psql -f tests/sql/draw-fonts-525.sql
DO $$
DECLARE pat text := '"fontFamily": "(?!(?:Roboto|Montserrat|Rubik|Nunito|Comfortaa|Exo 2|Jura|Tektur|Oswald|Unbounded|Russo One|Dela Gothic One|Rubik Mono One|Climate Crisis|Rubik Bubbles|Ruslan Display|Merriweather|Playfair Display|Roboto Slab|Yeseva One|Kurale|Poiret One|Lobster|Pacifico|Caveat|Marck Script|Press Start 2P|Tiny5|Handjet|JetBrains Mono)")';
BEGIN
 IF EXISTS (SELECT 1 FROM public.user_logos WHERE payload::text ~ pat) THEN RAISE EXCEPTION 'user_logos_old_font'; END IF;
 IF EXISTS (SELECT 1 FROM public.demo_template_data WHERE payload::text ~ pat) THEN RAISE EXCEPTION 'demo_old_font'; END IF;
 IF EXISTS (SELECT 1 FROM public.admin_demo_updates WHERE old_payload::text ~ pat OR new_payload::text ~ pat OR old_definition::text ~ pat) THEN RAISE EXCEPTION 'demo_updates_old_font'; END IF;
 IF EXISTS (SELECT 1 FROM public.admin_demo_targets WHERE expected_definition::text ~ pat) THEN RAISE EXCEPTION 'demo_targets_old_font'; END IF;
 IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.user_logos'::regclass
   AND tgname IN ('trg_user_logos_touch','copy_pending_logo') AND tgenabled = 'D') THEN RAISE EXCEPTION 'trigger_left_disabled'; END IF;
END $$;
