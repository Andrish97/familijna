-- Migracja 534: endpointy zapisu treści (gry, ustawienia, bazy, logo).
-- Uruchomienie: lokalna baza wg docs/sql/local-db.md (schema.sql + migracje
-- od 514 + 534), potem: psql ... -d fam -f tests/sql/content-endpoints-534.sql
\set ON_ERROR_STOP 1
\set owner '53400000-0000-4000-8000-0000000000aa'
\set other '53400000-0000-4000-8000-0000000000bb'
begin;
insert into auth.users(id,email) values (:'owner','o534@x.pl'), (:'other','x534@x.pl');
select set_config('request.jwt.claim.sub',:'owner',true);
set local role authenticated;

create function pg_temp.ok(r jsonb, what text) returns jsonb language plpgsql as $$
begin
  if not coalesce((r->>'ok')::boolean, false) then raise exception '% — oczekiwano ok: %', what, r; end if;
  return r;
end $$;
create function pg_temp.err(r jsonb, code text, what text) returns void language plpgsql as $$
begin
  if coalesce((r->>'ok')::boolean, false) or r->>'error' is distinct from code then
    raise exception '% — oczekiwano błędu %: %', what, code, r;
  end if;
end $$;
create function pg_temp.qs(g uuid) returns text language sql as $$
  select string_agg(q.ord || ':' || q.text || '[' || coalesce((
           select string_agg(a.text || '=' || a.fixed_points, ',' order by a.ord)
             from public.answers a where a.question_id = q.id), '') || ']', ' ' order by q.ord)
    from public.questions q where q.game_id = g $$;

do $$
declare
  r jsonb; g uuid; p uuid; q1 uuid; q2 uuid; q3 uuid; a uuid; b uuid; l uuid; s jsonb;
begin
  -- game_create: walidacja i tworzenie z treścią
  perform pg_temp.err(public.game_create('market', 'X', null), 'invalid_type', 'typ market');
  perform pg_temp.err(public.game_create('prepared', '   ', null), 'empty_name', 'pusta nazwa');
  r := pg_temp.ok(public.game_create('prepared', 'Gra 534',
         '[{"text":"Pierwsze","answers":[{"text":"Tak","points":60},{"text":"Nie","points":40}]},{"text":"Drugie"}]'), 'create');
  g := (r->>'id')::uuid;
  if (r->>'questions')::int <> 2 then raise exception 'create: liczba pytań %', r; end if;
  if pg_temp.qs(g) <> '1:Pierwsze[Tak=60,Nie=40] 2:Drugie[]' then raise exception 'create: treść %', pg_temp.qs(g); end if;

  -- treść błędna: gra nie powstaje
  r := public.game_create('prepared', 'Zła', '[{"text":""}]');
  perform pg_temp.err(r, 'empty_text', 'create z pustym pytaniem');
  if exists (select 1 from public.games where name = 'Zła') then raise exception 'create: gra została mimo błędu'; end if;

  -- game_content_apply: dodawanie na pozycji, przenoszenie, usuwanie
  select id into q1 from public.questions where game_id = g and ord = 1;
  select id into q2 from public.questions where game_id = g and ord = 2;
  r := pg_temp.ok(public.game_content_apply(g, '[
        {"op":"add_question","text":"Środek","position":2},
        {"op":"rename","name":"Gra 534 b"}]', 'tab-a'), 'add na pozycji');
  q3 := (r->'results'->0->>'question_id')::uuid;
  if pg_temp.qs(g) <> '1:Pierwsze[Tak=60,Nie=40] 2:Środek[] 3:Drugie[]' then raise exception 'pozycja: %', pg_temp.qs(g); end if;
  if (select name from public.games where id = g) <> 'Gra 534 b' then raise exception 'rename'; end if;

  perform pg_temp.ok(public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','move_question','question_id',q2,'position',1))), 'move');
  if pg_temp.qs(g) <> '1:Drugie[] 2:Pierwsze[Tak=60,Nie=40] 3:Środek[]' then raise exception 'move: %', pg_temp.qs(g); end if;

  perform pg_temp.ok(public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','delete_question','question_id',q1),
        jsonb_build_object('op','set_answers','question_id',q2,'answers','[{"text":"A","points":50},{"text":"B","points":30},{"text":"C","points":20}]'::jsonb),
        jsonb_build_object('op','update_question','question_id',q3,'text','  Środek 2  '))), 'delete+set_answers');
  if pg_temp.qs(g) <> '1:Drugie[A=50,B=30,C=20] 2:Środek 2[]' then raise exception 'delete: %', pg_temp.qs(g); end if;

  -- odpowiedzi: dodanie, zmiana, usunięcie, limit 6
  r := pg_temp.ok(public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','add_answer','question_id',q2,'text','D','points',5))), 'add_answer');
  a := (r->'results'->0->>'answer_id')::uuid;
  perform pg_temp.ok(public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','update_answer','answer_id',a,'text','DD','points',7))), 'update_answer');
  if pg_temp.qs(g) <> '1:Drugie[A=50,B=30,C=20,DD=7] 2:Środek 2[]' then raise exception 'answers: %', pg_temp.qs(g); end if;
  r := public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','add_answer','question_id',q2,'text','E'),
        jsonb_build_object('op','add_answer','question_id',q2,'text','F'),
        jsonb_build_object('op','add_answer','question_id',q2,'text','G')));
  perform pg_temp.err(r, 'too_many_answers', 'siódma odpowiedź');
  if (r->>'op_index')::int <> 3 then raise exception 'op_index: %', r; end if;
  -- wszystko albo nic: E i F też nie zostały
  if pg_temp.qs(g) <> '1:Drugie[A=50,B=30,C=20,DD=7] 2:Środek 2[]' then raise exception 'atomowość: %', pg_temp.qs(g); end if;
  perform pg_temp.ok(public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','delete_answer','answer_id',a))), 'delete_answer');

  -- limity treści z bazy i błędne dane
  r := public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','update_question','question_id',q3,'text',repeat('x', 150))));
  perform pg_temp.ok(r, 'tekst przycięty do 100');
  if (select char_length(text) from public.questions where id = q3) <> 100 then raise exception 'przycięcie'; end if;
  perform pg_temp.err(public.game_content_apply(g, '[{"op":"nope"}]'), 'unknown_op', 'nieznana operacja');
  perform pg_temp.err(public.game_content_apply(g, '[]'), 'invalid_payload', 'pusta lista');
  perform pg_temp.err(public.game_content_apply(g, jsonb_build_array(
        jsonb_build_object('op','update_question','question_id',gen_random_uuid(),'text','x'))), 'question_not_found', 'cudze pytanie');

  -- ankieta tekstowa nie ma odpowiedzi; punktacja zeruje punkty
  p := (pg_temp.ok(public.game_create('poll_text', 'Ankieta 534', '[{"text":"P1"}]'), 'create poll_text')->>'id')::uuid;
  select id into q1 from public.questions where game_id = p;
  perform pg_temp.err(public.game_content_apply(p, jsonb_build_array(
        jsonb_build_object('op','add_answer','question_id',q1,'text','x'))), 'answers_not_allowed', 'poll_text bez odpowiedzi');
  p := (pg_temp.ok(public.game_create('poll_points', 'Punktacja 534', '[{"text":"P1","answers":[{"text":"x","points":40}]}]'), 'create poll_points')->>'id')::uuid;
  if pg_temp.qs(p) <> '1:P1[x=0]' then raise exception 'poll_points punkty: %', pg_temp.qs(p); end if;

  -- otwarta ankieta: edycja zablokowana; zamknięta: wymaga zgody na reset
  p := (pg_temp.ok(public.game_create('poll_text', 'Otwarta 534',
         (select jsonb_agg(jsonb_build_object('text', 'Pytanie ' || i)) from generate_series(1, 10) i)), 'create 10')->>'id')::uuid;
  update public.games set status = 'poll_open' where id = p;
  perform pg_temp.err(public.game_content_apply(p, '[{"op":"rename","name":"x"}]'), 'edit_blocked', 'otwarta ankieta');

  -- blokada innej karty: tab-b trzyma grę, tab-a dostaje 'locked', tab-b może
  perform pg_temp.ok(public.acquire_edit_locks(jsonb_build_array(jsonb_build_object('type','game','id',g)), 'tab-b', 'editor'), 'blokada edytora');
  perform pg_temp.err(public.game_content_apply(g, '[{"op":"rename","name":"y"}]', 'tab-a'), 'locked', 'blokada innej karty');
  perform pg_temp.ok(public.game_content_apply(g, '[{"op":"rename","name":"y"}]', 'tab-b'), 'ta sama karta');

  -- ustawienia: CAS i blokada
  s := (select settings from public.games where id = g);
  perform pg_temp.err(public.game_settings_save(g, s, '{"a":1}', 'tab-a'), 'locked', 'ustawienia: blokada');
  perform pg_temp.ok(public.game_settings_save(g, s, '{"a":1}', 'tab-b'), 'ustawienia');
  perform pg_temp.err(public.game_settings_save(g, s, '{"a":2}', 'tab-b'), 'conflict', 'ustawienia: konflikt');
  perform pg_temp.ok(public.game_settings_save(g, '{"a":1}', '{"a":2}', 'tab-b'), 'ustawienia 2');

  -- bazy: nowa baza, folder z pytaniami, unikalna nazwa folderu
  b := (pg_temp.ok(public.base_create(' Baza 534 '), 'base_create')->>'id')::uuid;
  perform pg_temp.err(public.base_create(''), 'empty_name', 'baza bez nazwy');
  r := pg_temp.ok(public.qb_import_folder(b, 'Gra', '[{"text":"Q1","answers":[{"text":"a","fixed_points":10}]},{"text":"Q2"}]'), 'folder');
  if (r->>'questions')::int <> 2 then raise exception 'folder: %', r; end if;
  r := pg_temp.ok(public.qb_import_folder(b, 'Gra', '[]'), 'folder 2');
  if r->>'name' <> 'Gra (2)' then raise exception 'folder: nazwa %', r; end if;

  -- logo: nowe, nazwa zajęta, pula trzymana przez inną kartę
  l := (pg_temp.ok(public.logo_create('Logo 534', 'GLYPH_30x10', '{"layers":[]}'), 'logo_create')->>'id')::uuid;
  perform pg_temp.err(public.logo_create('Logo 534', 'GLYPH_30x10', '{}'), 'name_taken', 'logo: nazwa');
  perform pg_temp.err(public.logo_create('L2', 'BAD', '{}'), 'invalid_type', 'logo: typ');
  perform pg_temp.ok(public.acquire_edit_locks('[{"type":"logos","id":"53400000-0000-4000-8000-0000000000aa"}]', 'tab-c', 'control'), 'blokada puli logo');
  perform pg_temp.err(public.logo_create('L3', 'GLYPH_30x10', '{}', 'tab-a'), 'locked', 'logo: pula trzymana');

  -- inny użytkownik nie widzi i nie zmienia cudzej gry ani bazy
  perform set_config('request.jwt.claim.sub', '53400000-0000-4000-8000-0000000000bb', true);
  perform pg_temp.err(public.game_content_apply(g, '[{"op":"rename","name":"hack"}]'), 'not_found_or_forbidden', 'cudza gra');
  perform pg_temp.err(public.game_settings_save(g, null, '{}'), 'not_found_or_forbidden', 'cudze ustawienia');
  begin
    perform public.qb_import_folder(b, 'hack', '[]');
    raise exception 'cudza baza: brak odmowy';
  exception when sqlstate 'P0001' then
    if sqlerrm <> 'qb:forbidden' then raise; end if;
  end;
end $$;

-- anon nie ma dostępu do żadnego endpointu
reset role;
set local role anon;
do $$
begin
  perform public.game_create('prepared', 'x', null);
  raise exception 'anon: game_create dostępne';
exception when insufficient_privilege then null;
end $$;
reset role;
select 'content-endpoints-534: OK' as wynik;
rollback;
