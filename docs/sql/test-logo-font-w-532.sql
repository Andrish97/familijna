-- Test migracji 532 (litera „W” w logo napisowych bez dziury). Lokalna baza
-- wg docs/sql/local-db.md:
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -v ON_ERROR_STOP=1 -f docs/sql/test-logo-font-w-532.sql
-- Wszystko w transakcji wycofanej na końcu.
\set ON_ERROR_STOP 1
begin;
\ir ../../tests/sql/abuse-fixtures.sql

-- L1: „WAKACJE” ze starym „W”; L2: ▇ ▇ bez ◤Ѵ◥ pod spodem (nie „W” — zostaje);
-- L3: stare „W”, ale logo w ofercie kopii w toku (pomijane); L4: logo obrazkowe.
create temp table w_old as select '["                              ","                              "," █ █ ◢█◣ █ ╱ ◢█◣ ◢█◣   █ ███  "," █ █ █ █ █╱  █ █ █     █ █    "," █ █ ███ █╲  ███ █     █ ███  "," ▇ ▇ █ █ █ ╲ █ █ █   ◢ █ █    "," ◤Ѵ◥ █ █ █ ▐ █ █ ◥█◤ ◥█◤ ███  ","                              ","                              ","                              "]'::jsonb as rows;
insert into public.user_logos(id, user_id, name, type, payload, updated_at)
select '53200000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 'Wakacje', 'GLYPH_30x10',
       jsonb_build_object('layers', jsonb_build_array(jsonb_build_object('color', 'main', 'rows', w.rows)), 'source', jsonb_build_object('mode', 'TEXT', 'text', 'WAKACJE')),
       '2026-01-01T00:00:00Z' from w_old w;
insert into public.user_logos(id, user_id, name, type, payload) values
  ('53200000-0000-4000-8000-000000000002', 'a0000000-0000-4000-8000-00000000000a', 'Inne', 'GLYPH_30x10',
   '{"layers":[{"color":"main","rows":[" ▇ ▇ ", " ███ "]}]}');
insert into public.user_logos(id, user_id, name, type, payload)
select '53200000-0000-4000-8000-000000000003', 'a0000000-0000-4000-8000-00000000000a', 'Oferta', 'GLYPH_30x10',
       jsonb_build_object('layers', jsonb_build_array(jsonb_build_object('color', 'main', 'rows', w.rows))) from w_old w;
insert into public.resource_copy_offers(recipient_id, sender_id, sender_identity, sender_label, source_id, resource_kind, variant, name, request_id, payload_hash, logo_id)
values ('b0000000-0000-4000-8000-00000000000b', 'a0000000-0000-4000-8000-00000000000a', 'a0000000-0000-4000-8000-00000000000a', 'A',
        '53200000-0000-4000-8000-000000000003', 'logo', 'GLYPH_30x10', 'Oferta', gen_random_uuid(), repeat('a', 64), '53200000-0000-4000-8000-000000000003');
insert into public.demo_template_data(lang, slot, payload)
select 'pl', 'logo_text_w532', jsonb_build_object('name', 'Wakacje', 'kind', 'GLYPH', 'payload', jsonb_build_object('layers', jsonb_build_array(jsonb_build_object('color', 'main', 'rows', w.rows))))
from w_old w;

\ir ../../supabase/migrations/2026-11-08_532_logo_font_w.sql

do $$ declare r jsonb; begin
  select payload #> '{layers,0,rows}' into r from public.user_logos where id = '53200000-0000-4000-8000-000000000001';
  if r ->> 5 <> ' █ █ █ █ █ ╲ █ █ █   ◢ █ █    ' then raise exception 'L1: W nie poprawione: %', r ->> 5; end if;
  if r ->> 6 <> ' ◤Ѵ◥ █ █ █ ▐ █ █ ◥█◤ ◥█◤ ███  ' or r ->> 2 <> ' █ █ ◢█◣ █ ╱ ◢█◣ ◢█◣   █ ███  ' then raise exception 'L1: inne wiersze zmienione'; end if;
  if (select updated_at from public.user_logos where id = '53200000-0000-4000-8000-000000000001') <> '2026-01-01T00:00:00Z' then raise exception 'L1: zmieniona data zmiany'; end if;
  if (select payload #>> '{source,text}' from public.user_logos where id = '53200000-0000-4000-8000-000000000001') <> 'WAKACJE' then raise exception 'L1: źródło zmienione'; end if;
  if (select payload #> '{layers,0,rows}' from public.user_logos where id = '53200000-0000-4000-8000-000000000002') <> '[" ▇ ▇ ", " ███ "]' then raise exception 'L2: zmieniony znak spoza wzoru W'; end if;
  if (select (payload #>> '{layers,0,rows,5}') from public.user_logos where id = '53200000-0000-4000-8000-000000000003') not like ' ▇ ▇ %' then raise exception 'L3: logo w ofercie w toku zmienione'; end if;
  if (select payload #>> '{payload,layers,0,rows,5}' from public.demo_template_data where slot = 'logo_text_w532') <> ' █ █ █ █ █ ╲ █ █ █   ◢ █ █    ' then raise exception 'szablon: W nie poprawione'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_user_logos_touch' and tgenabled = 'O') then raise exception 'wyzwalacz touch nie włączony z powrotem'; end if;
  raise notice 'test 532: OK';
end $$;
rollback;
