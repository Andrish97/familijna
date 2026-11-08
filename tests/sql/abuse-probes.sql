-- Sondy nadużyć: co zwykły użytkownik (B), gość (G) lub anonim może zrobić
-- z cudzymi danymi (A) albo z zasadami serwera, omijając interfejs.
-- Lokalna baza wg docs/sql/local-db.md (schema.sql + migracje brancha).
-- Każda sonda w osobnej podtransakcji (zmiany wycofane). Wynik: tabela
-- sond; „luka” = serwer pozwolił na rzecz, której nie powinien. Na końcu
-- błąd, gdy jakakolwiek sonda wykryła lukę (zapadka po poprawkach).
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -f tests/sql/abuse-probes.sql
\set ON_ERROR_STOP 1
begin;
-- 528 odbiera domyślne EXECUTE nowym funkcjom; pomocnicze pg_temp.* testu
-- wołane jako authenticated muszą je mieć (cofane razem z transakcją).
alter default privileges grant execute on functions to public;

create temp table probe(code text primary key, leak boolean, note text);
grant all on probe to public;

-- Wykonanie jako użytkownik (rola authenticated + sub) / anonim / właściciel bazy.
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp.as_service() returns void language plpgsql as $f$ begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $f$;
create function pg_temp.as_admin() returns void language plpgsql as $$ begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

\ir abuse-fixtures.sql

-- ---------------------------------------------------------------- sondy
-- Wzorzec: blok wewnętrzny kończy się wyjątkiem P9999 z wynikiem, więc
-- wszystko, co sonda zmieniła, jest wycofane; inny błąd = serwer odmówił.
create function pg_temp.done(p_code text, p_leak boolean, p_note text default '') returns void language plpgsql as $$
begin raise exception using errcode = 'P9999', message = p_code || '|' || p_leak::text || '|' || coalesce(p_note, ''); end $$;
create function pg_temp.record(p_msg text, p_code text, p_state text) returns void language plpgsql as $$
begin
  perform pg_temp.as_admin();
  if p_state = 'P9999' then
    insert into probe values (split_part(p_msg, '|', 1), split_part(p_msg, '|', 2)::boolean, split_part(p_msg, '|', 3));
  else
    insert into probe values (p_code, false, 'odmowa: ' || left(p_msg, 120));
  end if;
end $$;

-- K1: anonim oznacza dowolny adres jako „konto potwierdzone” (blokuje rejestrację).
do $$ begin begin
  perform pg_temp.as_anon();
  perform public.email_mark_confirmed('ofiara-k1@probe.test');
  perform pg_temp.as_admin();
  perform pg_temp.done('K1 email_mark_confirmed anon', exists (select 1 from public.email_intents where email = 'ofiara-k1@probe.test'));
exception when others then perform pg_temp.record(sqlerrm, 'K1 email_mark_confirmed anon', sqlstate); end; end $$;

-- K1b: zalogowany oznacza cudzy adres.
do $$ begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  perform public.email_mark_confirmed('ofiara-k1b@probe.test');
  perform pg_temp.as_admin();
  perform pg_temp.done('K1b email_mark_confirmed cudzy adres', exists (select 1 from public.email_intents where email = 'ofiara-k1b@probe.test'));
exception when others then perform pg_temp.record(sqlerrm, 'K1b email_mark_confirmed cudzy adres', sqlstate); end; end $$;

-- K2: anonim zakłada „oczekującą zmianę” na dowolny adres.
do $$ begin begin
  perform pg_temp.as_anon();
  perform public.initiate_email_change_intent('ofiara-k2@probe.test');
  perform pg_temp.as_admin();
  perform pg_temp.done('K2 initiate_email_change_intent anon', exists (select 1 from public.email_intents where email = 'ofiara-k2@probe.test'));
exception when others then perform pg_temp.record(sqlerrm, 'K2 initiate_email_change_intent anon', sqlstate); end; end $$;

-- K2b: zalogowany przejmuje cudzą intencję (user_id innej osoby).
do $$ begin begin
  insert into public.email_intents(email, intent, status, user_id) values ('nowy-a@probe.test', 'guest_migrate', 'pending', 'a0000000-0000-4000-8000-00000000000a');
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  perform public.initiate_email_change_intent('nowy-a@probe.test');
  perform pg_temp.as_admin();
  perform pg_temp.done('K2b initiate_email_change_intent cudza intencja',
    (select user_id from public.email_intents where email = 'nowy-a@probe.test') is distinct from 'a0000000-0000-4000-8000-00000000000a');
exception when others then perform pg_temp.record(sqlerrm, 'K2b initiate_email_change_intent cudza intencja', sqlstate); end; end $$;

-- K4: zwykły użytkownik zmienia sobie kolumny chronione (gość/ważność/e-mail).
do $$ declare n int; begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  update public.profiles set guest_expires_at = '9999-01-01' where id = '90000000-0000-4000-8000-000000000009';
  get diagnostics n = row_count;
  perform pg_temp.done('K4a gość przedłuża sobie ważność', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'K4a gość przedłuża sobie ważność', sqlstate); end; end $$;
do $$ declare n int; begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  update public.profiles set is_guest = false where id = '90000000-0000-4000-8000-000000000009';
  get diagnostics n = row_count;
  perform pg_temp.done('K4b gość zdejmuje sobie is_guest', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'K4b gość zdejmuje sobie is_guest', sqlstate); end; end $$;
do $$ declare n int; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  update public.profiles set email = 'ofiara-k4@probe.test' where id = 'b0000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  perform pg_temp.done('K4c profil zajmuje cudzy e-mail', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'K4c profil zajmuje cudzy e-mail', sqlstate); end; end $$;
do $$ declare n int; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  update public.profiles set username = '<img src=x onerror=alert(1)>' where id = 'b0000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  perform pg_temp.done('K4d nazwa użytkownika z HTML/bez formatu', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'K4d nazwa użytkownika z HTML/bez formatu', sqlstate); end; end $$;
do $$ declare n int; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  update public.profiles set username = '' where id = 'b0000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  perform pg_temp.done('K4e pusta nazwa użytkownika', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'K4e pusta nazwa użytkownika', sqlstate); end; end $$;

-- K6: migracja gościa z hasłem jednoznakowym (omija zasady haseł).
do $$ declare r jsonb; begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  r := public.guest_stage_migration('gosc_probe', 'a');
  perform pg_temp.done('K6 słabe hasło przy migracji gościa', coalesce((r->>'ok')::boolean, false), r::text);
exception when others then perform pg_temp.record(sqlerrm, 'K6 słabe hasło przy migracji gościa', sqlstate); end; end $$;

-- K8: gość ocenia system (interfejs ukrywa ocenę gościom).
do $$ declare n int; begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  insert into public.app_ratings(user_id, stars, comment) values ('90000000-0000-4000-8000-000000000009', 5, repeat('x', 100000));
  get diagnostics n = row_count;
  perform pg_temp.done('K8 gość ocenia system (komentarz 100k)', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'K8 gość ocenia system (komentarz 100k)', sqlstate); end; end $$;

-- G1: przeniesienie odpowiedzi z ankiety w trakcie do szkicu (treść zablokowana).
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  update public.answers set question_id = 'a2000000-0000-4000-8000-000000000999'
   where question_id = 'a2000000-0000-4000-8000-000000000201' and ord = 1;
  get diagnostics n = row_count;
  perform pg_temp.done('G1a odpowiedź wyprowadzona z zablokowanej ankiety', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G1a odpowiedź wyprowadzona z zablokowanej ankiety', sqlstate); end; end $$;
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  update public.questions set game_id = 'a1000000-0000-4000-8000-000000000004', ord = 2
   where id = 'a2000000-0000-4000-8000-000000000201';
  get diagnostics n = row_count;
  perform pg_temp.done('G1b pytanie wyprowadzone z zablokowanej ankiety', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G1b pytanie wyprowadzone z zablokowanej ankiety', sqlstate); end; end $$;

-- G2: kopia ze Społeczności zamieniona we własną grę.
do $$ declare n int; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  update public.games set type = 'prepared', source_market_id = null where id = 'b1000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  perform pg_temp.done('G2 kopia Społeczności -> własna gra', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G2 kopia Społeczności -> własna gra', sqlstate); end; end $$;

-- G2b: gra demo (szablon serwisu) zamieniona we własną (np. do wysłania do Społeczności).
do $$ declare n int; begin begin
  insert into public.games(id, owner_id, name, type, status, is_demo) values
    ('b1000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-00000000000b', 'demo B', 'prepared', 'draft', true);
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  update public.games set is_demo = false where id = 'b1000000-0000-4000-8000-000000000002';
  get diagnostics n = row_count;
  perform pg_temp.done('G2b gra demo -> własna gra', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G2b gra demo -> własna gra', sqlstate); end; end $$;

-- G3: gra ankietowa „gotowa” bez przeprowadzenia ankiety.
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  update public.games set status = 'ready' where id = 'a1000000-0000-4000-8000-000000000003';
  get diagnostics n = row_count;
  perform pg_temp.done('G3 ankieta gotowa bez ankiety', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G3 ankieta gotowa bez ankiety', sqlstate); end; end $$;

-- G3b: gra ankietowa wstawiona od razu jako „gotowa”.
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  insert into public.games(owner_id, name, type, status) values ('a0000000-0000-4000-8000-00000000000a', 'gotowa od razu', 'poll_points', 'ready');
  get diagnostics n = row_count;
  perform pg_temp.done('G3b ankieta wstawiona jako gotowa', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G3b ankieta wstawiona jako gotowa', sqlstate); end; end $$;

-- G4: nazwa logo bez limitu.
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  update public.user_logos set name = repeat('x', 5000) where id = 'a7000000-0000-4000-8000-000000000001';
  get diagnostics n = row_count;
  perform pg_temp.done('G4 nazwa logo 5000 znaków', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'G4 nazwa logo 5000 znaków', sqlstate); end; end $$;

-- R1: nazwa bazy bez limitu.
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  insert into public.question_bases(owner_id, name) values ('a0000000-0000-4000-8000-00000000000a', repeat('x', 5000));
  get diagnostics n = row_count;
  perform pg_temp.done('R1 nazwa bazy 5000 znaków', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R1 nazwa bazy 5000 znaków', sqlstate); end; end $$;

-- R2a: autor ocenia własną grę z pominięciem RPC.
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  insert into public.market_game_ratings(market_game_id, user_id, stars) values ('a3000000-0000-4000-8000-000000000001', 'a0000000-0000-4000-8000-00000000000a', 5);
  get diagnostics n = row_count;
  perform pg_temp.done('R2a autor ocenia własną grę (tabela)', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R2a autor ocenia własną grę (tabela)', sqlstate); end; end $$;
-- R2b: ocena gry oczekującej na moderację.
do $$ declare n int; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  insert into public.market_game_ratings(market_game_id, user_id, stars) values ('a3000000-0000-4000-8000-000000000003', 'b0000000-0000-4000-8000-00000000000b', 1);
  get diagnostics n = row_count;
  perform pg_temp.done('R2b ocena gry oczekującej (tabela)', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R2b ocena gry oczekującej (tabela)', sqlstate); end; end $$;
-- R2c: pompowanie licznika biblioteki (INSERT, UPDATE na inną grę, INSERT).
do $$ declare c0 int; c1 int; begin begin
  select coalesce(library_count, 0) into c0 from public.market_games where id = 'a3000000-0000-4000-8000-000000000001';
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  insert into public.user_market_library(user_id, market_game_id) values ('b0000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-000000000001');
  update public.user_market_library set market_game_id = 'a3000000-0000-4000-8000-000000000002'
   where user_id = 'b0000000-0000-4000-8000-00000000000b' and market_game_id = 'a3000000-0000-4000-8000-000000000001';
  insert into public.user_market_library(user_id, market_game_id) values ('b0000000-0000-4000-8000-00000000000b', 'a3000000-0000-4000-8000-000000000001');
  perform pg_temp.as_admin();
  select coalesce(library_count, 0) into c1 from public.market_games where id = 'a3000000-0000-4000-8000-000000000001';
  perform pg_temp.done('R2c pompowanie licznika biblioteki', c1 - c0 > 1, c0 || '->' || c1);
exception when others then perform pg_temp.record(sqlerrm, 'R2c pompowanie licznika biblioteki', sqlstate); end; end $$;

-- R3: pytanie w bazie z 8 odpowiedziami i punktami 500.
do $$ declare r jsonb; n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  r := to_jsonb(public.qb_create_question('a4000000-0000-4000-8000-000000000001', null,
    jsonb_build_object('text', 'pytanie', 'answers', (select jsonb_agg(jsonb_build_object('text', 'o' || i, 'fixed_points', 500)) from generate_series(1, 8) i))));
  perform pg_temp.as_admin();
  select count(*) into n from public.qb_questions where base_id = 'a4000000-0000-4000-8000-000000000001' and jsonb_array_length(payload->'answers') = 8;
  perform pg_temp.done('R3 pytanie bazy: 8 odpowiedzi, 500 pkt', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R3 pytanie bazy: 8 odpowiedzi, 500 pkt', sqlstate); end; end $$;

-- R4: kolor tagu z wstrzyknięciem CSS.
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  perform public.qb_save_tag('a4000000-0000-4000-8000-000000000001', null, 'nowytag', 'red;background:url(//x.test/a)');
  perform pg_temp.as_admin();
  select count(*) into n from public.qb_tags where base_id = 'a4000000-0000-4000-8000-000000000001' and color like '%url(%';
  perform pg_temp.done('R4 kolor tagu z CSS', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R4 kolor tagu z CSS', sqlstate); end; end $$;

-- R7: tag ze spacją i folder 5000 znaków wprost do tabeli (z pominięciem qb_save_tag).
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  insert into public.qb_tags(base_id, name, color) values ('a4000000-0000-4000-8000-000000000001', 'dwa słowa', '#4DA3FF');
  get diagnostics n = row_count;
  perform pg_temp.done('R7a tag ze spacją wprost do tabeli', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R7a tag ze spacją wprost do tabeli', sqlstate); end; end $$;
do $$ declare n int; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  insert into public.qb_categories(base_id, name) values ('a4000000-0000-4000-8000-000000000001', repeat('z', 5000));
  get diagnostics n = row_count;
  perform pg_temp.done('R7b folder 5000 znaków wprost do tabeli', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R7b folder 5000 znaków wprost do tabeli', sqlstate); end; end $$;

-- R5: gość ocenia grę w Społeczności przez RPC.
do $$ declare ok boolean; begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  select r.ok into ok from public.market_rate_game('a3000000-0000-4000-8000-000000000001', 1) r;
  perform pg_temp.done('R5 gość ocenia grę w Społeczności', coalesce(ok, false));
exception when others then perform pg_temp.record(sqlerrm, 'R5 gość ocenia grę w Społeczności', sqlstate); end; end $$;

-- R6: tag z cudzej bazy przypięty do własnego pytania.
do $$ declare n int; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  insert into public.qb_question_tags(question_id, tag_id) values ('b5000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001');
  get diagnostics n = row_count;
  perform pg_temp.done('R6 tag cudzej bazy przy własnym pytaniu', n > 0);
exception when others then perform pg_temp.record(sqlerrm, 'R6 tag cudzej bazy przy własnym pytaniu', sqlstate); end; end $$;

-- P1: pytania dowolnej gry bez klucza ankiety (p_key = NULL).
do $$ declare r jsonb; begin begin
  perform pg_temp.as_anon();
  r := public.get_poll_game('a1000000-0000-4000-8000-000000000001', null);
  perform pg_temp.done('P1 get_poll_game bez klucza', r::text like '%SEKRET_A%');
exception when others then perform pg_temp.record(sqlerrm, 'P1 get_poll_game bez klucza', sqlstate); end; end $$;

-- P2a: anonim zgaduje kody bez limitu (z przeglądarki, z pominięciem Workera).
do $$ declare r jsonb; begin begin
  perform pg_temp.as_anon();
  r := public.resolve_device_connect_code('424242');
  perform pg_temp.done('P2a anonim rozwiązuje kod bez Workera', (r->>'ok')::boolean is true);
exception when others then perform pg_temp.record(sqlerrm, 'P2a anonim rozwiązuje kod bez Workera', sqlstate); end; end $$;
-- P2b: kod po zakończeniu sesji Control oddaje martwy klucz (zamiast „brak kodu”).
do $$ declare r jsonb; c text; begin begin
  insert into public.control_device_link_tokens(session_id, game_id, device_type, token) values
    ('ab000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000005', 'buzzer', 'ad000000-0000-4000-8000-000000000002');
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  c := public.generate_device_connect_code('a1000000-0000-4000-8000-000000000005', 'buzzer', 'ad000000-0000-4000-8000-000000000002', 'gra', null)->>'code';
  perform pg_temp.as_admin();
  update public.control_runtime_sessions set ended_at = now() where id = 'ab000000-0000-4000-8000-000000000001';
  perform pg_temp.as_service();
  r := public.resolve_device_connect_code(c);
  perform pg_temp.done('P2b kod po końcu sesji Control', (r->>'ok')::boolean is true);
exception when others then perform pg_temp.record(sqlerrm, 'P2b kod po końcu sesji Control', sqlstate); end; end $$;
-- P2c: kod ankiety po jej zamknięciu.
do $$ declare r jsonb; c text; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  c := public.generate_device_connect_code('a1000000-0000-4000-8000-000000000002', 'poll_qr', 'probekeyA', 'gra', null)->>'code';
  perform pg_temp.as_admin();
  update public.games set share_key_poll = 'innyklucz' where id = 'a1000000-0000-4000-8000-000000000002';
  perform pg_temp.as_service();
  r := public.resolve_device_connect_code(c);
  perform pg_temp.done('P2c kod ankiety po zmianie klucza', (r->>'ok')::boolean is true);
exception when others then perform pg_temp.record(sqlerrm, 'P2c kod ankiety po zmianie klucza', sqlstate); end; end $$;

-- P3: kod urządzenia dla cudzej gry z podstawioną nazwą i kluczem.
do $$ declare r jsonb; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  r := public.generate_device_connect_code('a1000000-0000-4000-8000-000000000001', 'display', 'podrobiony', 'Podrobiona gra', null);
  perform pg_temp.as_admin();
  perform pg_temp.done('P3 kod urządzenia dla cudzej gry',
    exists (select 1 from public.device_connect_codes where game_id = 'a1000000-0000-4000-8000-000000000001' and owner_id = 'b0000000-0000-4000-8000-00000000000b'));
exception when others then perform pg_temp.record(sqlerrm, 'P3 kod urządzenia dla cudzej gry', sqlstate); end; end $$;

-- P3b: kod urządzenia bez daty ważności (żyje bez końca).
do $$ declare r jsonb; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  r := public.generate_device_connect_code('a1000000-0000-4000-8000-000000000001', 'display', 'klucz', 'gra', null);
  perform pg_temp.as_admin();
  perform pg_temp.done('P3b kod urządzenia bez ważności',
    exists (select 1 from public.device_connect_codes where game_id = 'a1000000-0000-4000-8000-000000000001' and expires_at is null));
exception when others then perform pg_temp.record(sqlerrm, 'P3b kod urządzenia bez ważności', sqlstate); end; end $$;

-- K5: rejestracja, gdy nazwa z części adresu przed „@” jest zajęta albo
-- niezgodna z zasadami (handle_new_user na auth.users; lokalny zrzut nie ma
-- wyzwalacza schematu auth, więc test zakłada go jak na produkcji).
do $$ begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into auth.users(id, email, raw_user_meta_data) values ('d0000000-0000-4000-8000-00000000000d', 'probe_a@inny.test', '{}');
  perform pg_temp.done('K5a rejestracja: nazwa z adresu zajęta',
    false, coalesce((select username from public.profiles where id = 'd0000000-0000-4000-8000-00000000000d'), '(bez nazwy)'));
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'K5a', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('K5a rejestracja: nazwa z adresu zajęta', true, 'rejestracja pada: ' || left(sqlerrm, 100)); end if;
end; end $$;
do $$ declare u text; begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into auth.users(id, email, raw_user_meta_data) values ('d0000000-0000-4000-8000-00000000000e', 'Jan+Kowalski@inny.test', '{}');
  select username into u from public.profiles where id = 'd0000000-0000-4000-8000-00000000000e';
  perform pg_temp.done('K5b rejestracja: nazwa z adresu łamie zasady nazw', u is not null and u !~ '^[a-zA-Z0-9_.-]{3,20}$', coalesce(u, '(bez nazwy)'));
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'K5b', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('K5b rejestracja: nazwa z adresu łamie zasady nazw', true, 'rejestracja pada: ' || left(sqlerrm, 100)); end if;
end; end $$;

-- X: ogólne — B czyta/zmienia/usuwa wiersze A w każdej tabeli z kolumną właściciela.
do $$ declare t record; n int; leaks text := ''; begin
  for t in
    select c.table_name, c.column_name from information_schema.columns c
    join pg_class k on k.relname = c.table_name and k.relkind = 'r'
    join pg_namespace s on s.oid = k.relnamespace and s.nspname = 'public'
    where c.table_schema = 'public' and c.data_type = 'uuid'
      and c.column_name in ('owner_id', 'user_id', 'author_user_id', 'requester_id', 'holder_user_id')
  loop
    begin
      perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
      execute format('select count(*) from public.%I where %I = %L', t.table_name, t.column_name, 'a0000000-0000-4000-8000-00000000000a')
        || case when t.table_name = 'market_games' then ' and status <> ''published''' else '' end into n;
      if n > 0 then leaks := leaks || t.table_name || ':select ' ; end if;
      execute format('update public.%I set %I = %I where %I = %L', t.table_name, t.column_name, t.column_name, t.column_name, 'a0000000-0000-4000-8000-00000000000a');
      get diagnostics n = row_count;
      if n > 0 then leaks := leaks || t.table_name || ':update '; end if;
      perform pg_temp.done('x', false);
    exception when others then perform pg_temp.as_admin();
    end;
  end loop;
  insert into probe values ('X RLS cudze wiersze (select/update)', leaks <> '', leaks);
end $$;

-- K3: anonim rezerwuje odliczanie resetu hasła cudzego adresu (ofiara nie dostaje linku przez godzinę).
do $$ declare ok boolean; begin begin
  perform pg_temp.as_anon();
  select r.ok into ok from public.mail_cooldown_email_reserve('auth:reset_password', 'probe-a@probe.test') r;
  perform pg_temp.done('K3 anonim blokuje reset hasła cudzego adresu', coalesce(ok, false));
exception when others then perform pg_temp.record(sqlerrm, 'K3 anonim blokuje reset hasła cudzego adresu', sqlstate); end; end $$;
do $$ declare ok boolean; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  select r.ok into ok from public.mail_cooldown_reserve('auth:reset_password', 'email:' || md5('probe-a@probe.test')) r;
  perform pg_temp.done('K3b surowa rezerwacja odliczania z przeglądarki', coalesce(ok, false));
exception when others then perform pg_temp.record(sqlerrm, 'K3b surowa rezerwacja odliczania z przeglądarki', sqlstate); end; end $$;

-- ---------------------------------------------------------------- czynności prawidłowe
-- To, co robi interfejs, ma dalej działać (kod L…; „LUKA” = poprawka zablokowała
-- prawidłową czynność). Każda w osobnej podtransakcji, jako podany użytkownik.
create function pg_temp.legit(p_code text, p_uid uuid, p_sql text, p_check text default null) returns void language plpgsql as $$
declare ok boolean := true;
begin
  begin
    if p_uid is null then perform pg_temp.as_anon(); else perform pg_temp.as_user(p_uid); end if;
    execute p_sql;
    perform pg_temp.as_admin();
    if p_check is not null then execute 'select (' || p_check || ')' into ok; end if;
    perform pg_temp.done(p_code, not coalesce(ok, false), case when coalesce(ok, false) then '' else 'warunek niespełniony' end);
  exception when others then
    if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, p_code, sqlstate);
    else perform pg_temp.as_admin(); insert into probe values (p_code, true, 'BLOKADA: ' || left(sqlerrm, 110)); end if;
  end;
end $$;

select pg_temp.legit('L01 zmiana nazwy użytkownika', 'b0000000-0000-4000-8000-00000000000b',
  $q$update public.profiles set username = 'probe_b2' where id = auth.uid()$q$,
  $q$exists (select 1 from public.profiles where username = 'probe_b2')$q$);
select pg_temp.legit('L02 e-mail profilu = adres logowania (confirm.js)', 'b0000000-0000-4000-8000-00000000000b',
  $q$update public.profiles set email = null where id = auth.uid() and false;
     update public.profiles set email = 'probe-b@probe.test' where id = auth.uid()$q$);
select pg_temp.legit('L03 nowa gra (szkic)', 'a0000000-0000-4000-8000-00000000000a',
  $q$insert into public.games(name, owner_id, type, status) values ('nowa', auth.uid(), 'poll_points', 'draft')$q$);
select pg_temp.legit('L04 nazwa i ustawienia gry', 'a0000000-0000-4000-8000-00000000000a',
  $q$update public.games set name = 'inna', settings = '{"x":1}' where id = 'a1000000-0000-4000-8000-000000000001'$q$,
  $q$(select name from public.games where id = 'a1000000-0000-4000-8000-000000000001') = 'inna'$q$);
select pg_temp.legit('L05 edytor: pytanie i odpowiedź w szkicu', 'a0000000-0000-4000-8000-00000000000a',
  $q$insert into public.questions(game_id, ord, text) values ('a1000000-0000-4000-8000-000000000001', 11, 'nowe');
     update public.answers set text = 'zmiana' where question_id = 'a2000000-0000-4000-8000-000000000101' and ord = 1;
     update public.answers set question_id = 'a2000000-0000-4000-8000-000000000999' where question_id = 'a2000000-0000-4000-8000-000000000101' and ord = 2$q$);
select pg_temp.legit('L05b otwarcie ankiety zmianą statusu (Warstwa 2)', 'a0000000-0000-4000-8000-00000000000a',
  $q$update public.games set status = 'poll_open' where id = 'a1000000-0000-4000-8000-000000000003'$q$);
select pg_temp.legit('L06 pytanie w bazie: 6 odpowiedzi 0–100 pkt', 'a0000000-0000-4000-8000-00000000000a',
  $q$select public.qb_create_question('a4000000-0000-4000-8000-000000000001', null,
       jsonb_build_object('text', 'ok', 'answers', (select jsonb_agg(jsonb_build_object('text', 'o' || i, 'fixed_points', i * 10)) from generate_series(1, 6) i)))$q$);
select pg_temp.legit('L07 tag z kolorem z palety', 'a0000000-0000-4000-8000-00000000000a',
  $q$select public.qb_save_tag('a4000000-0000-4000-8000-000000000001', null, 'paleta', '#4DA3FF')$q$);
select pg_temp.legit('L08 tag tej samej bazy przy pytaniu', 'a0000000-0000-4000-8000-00000000000a',
  $q$insert into public.qb_question_tags(question_id, tag_id) values ('a5000000-0000-4000-8000-000000000001', 'a6000000-0000-4000-8000-000000000001')$q$);
select pg_temp.legit('L09 ocena gry w Społeczności (RPC)', 'b0000000-0000-4000-8000-00000000000b',
  $q$select public.market_rate_game('a3000000-0000-4000-8000-000000000001', 4)$q$,
  $q$exists (select 1 from public.market_game_ratings where user_id = 'b0000000-0000-4000-8000-00000000000b')$q$);
select pg_temp.legit('L10 kod urządzenia dla własnej gry', 'a0000000-0000-4000-8000-00000000000a',
  $q$select public.generate_device_connect_code('a1000000-0000-4000-8000-000000000002', 'poll_qr', 'probekeyA', 'SEKRET_A ankieta', null)$q$,
  $q$exists (select 1 from public.device_connect_codes where game_id = 'a1000000-0000-4000-8000-000000000002' and expires_at > now())$q$);
select pg_temp.legit('L12 pytania ankiety z kluczem (anonim)', null,
  $q$select public.get_poll_game('a1000000-0000-4000-8000-000000000002', 'probekeyA')$q$);
select pg_temp.legit('L13 migracja gościa z mocnym hasłem', '90000000-0000-4000-8000-000000000009',
  $q$do $d$ begin if not (public.guest_stage_migration('gosc_ok', 'Abcdef1!')->>'ok')::boolean then raise exception 'odmowa'; end if; end $d$$q$);
select pg_temp.legit('L14 ocena systemu (zarejestrowany)', 'b0000000-0000-4000-8000-00000000000b',
  $q$insert into public.app_ratings(user_id, stars, comment) values (auth.uid(), 4, 'ok')$q$);
select pg_temp.legit('L14b ocena systemu (gość, 527)', '90000000-0000-4000-8000-000000000009',
  $q$insert into public.app_ratings(user_id, stars, comment) values (auth.uid(), 5, 'ok')$q$,
  $q$exists (select 1 from public.app_ratings where user_id = '90000000-0000-4000-8000-000000000009' and from_guest)$q$);
select pg_temp.legit('L15 potwierdzenie własnego adresu', 'a0000000-0000-4000-8000-00000000000a',
  $q$select public.email_mark_confirmed('probe-a@probe.test')$q$,
  $q$exists (select 1 from public.email_intents where email = 'probe-a@probe.test' and status = 'confirmed')$q$);
select pg_temp.legit('L16 zmiana e-maila: intencja', 'a0000000-0000-4000-8000-00000000000a',
  $q$select public.initiate_email_change_intent('nowy-adres-a@probe.test')$q$,
  $q$exists (select 1 from public.email_intents where email = 'nowy-adres-a@probe.test' and user_id = 'a0000000-0000-4000-8000-00000000000a')$q$);
select pg_temp.legit('L17 odliczanie zamiany gościa na konto', '90000000-0000-4000-8000-000000000009',
  $q$select public.mail_cooldown_email_reserve('auth:guest_upgrade_email', 'gosc@probe.test')$q$);
select pg_temp.legit('L18 nazwa logo 80 znaków, nowa baza', 'a0000000-0000-4000-8000-00000000000a',
  $q$update public.user_logos set name = repeat('x', 80) where id = 'a7000000-0000-4000-8000-000000000001';
     insert into public.question_bases(owner_id, name) values (auth.uid(), 'Baza')$q$);
do $$ begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into auth.users(id, email, raw_user_meta_data) values ('d0000000-0000-4000-8000-0000000000f1', 'wolna.nazwa@inny.test', '{}');
  perform pg_temp.done('L19 rejestracja: wolna nazwa z adresu',
    (select username from public.profiles where id = 'd0000000-0000-4000-8000-0000000000f1') is distinct from 'wolna.nazwa');
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'L19', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('L19 rejestracja: wolna nazwa z adresu', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;
-- 516: nazwa e2e.<role><NN> przy rejestracji -- zostaje dla adresu tożsamości
-- testowej (L20, konto zakładane ponownie formularzem), obcy adres jej nie
-- dostanie (K5c). 517: takie konto (bez user_id w e2e_identities) od razu
-- wykluczone ze statystyk i list admina (L21), zwykłe nie (K5d).
do $$ begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into public.reserved_username_prefixes(prefix, kind) values ('e2e.', 'test') on conflict do nothing;
  insert into public.e2e_identities(name, role, email) values ('e2e.disposable99', 'disposable', 'e2e+disposable99@familijna.app') on conflict do nothing;
  insert into auth.users(id, email, raw_user_meta_data) values
    ('d0000000-0000-4000-8000-0000000000f2', 'e2e+disposable99@familijna.app', '{"username":"e2e.disposable99"}'),
    ('d0000000-0000-4000-8000-0000000000f3', 'obcy@inny.test', '{"username":"e2e.disposable99"}');
  perform pg_temp.done('L20 rejestracja tożsamości testowej z jej nazwą',
    (select username from public.profiles where id = 'd0000000-0000-4000-8000-0000000000f2') is distinct from 'e2e.disposable99');
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'L20', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('L20 rejestracja tożsamości testowej z jej nazwą', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;
do $$ begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into public.reserved_username_prefixes(prefix, kind) values ('e2e.', 'test') on conflict do nothing;
  insert into public.e2e_identities(name, role, email) values ('e2e.disposable99', 'disposable', 'e2e+disposable99@familijna.app') on conflict do nothing;
  insert into auth.users(id, email, raw_user_meta_data) values
    ('d0000000-0000-4000-8000-0000000000f2', 'e2e+disposable99@familijna.app', '{"username":"e2e.disposable99"}'),
    ('d0000000-0000-4000-8000-0000000000f3', 'obcy@inny.test', '{"username":"e2e.disposable99"}');
  perform pg_temp.done('K5c obcy adres z nazwą tożsamości testowej',
    (select username from public.profiles where id = 'd0000000-0000-4000-8000-0000000000f3') is not null);
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'K5c', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('K5c obcy adres z nazwą tożsamości testowej', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;
do $$ begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into public.reserved_username_prefixes(prefix, kind) values ('e2e.', 'test') on conflict do nothing;
  insert into public.e2e_identities(name, role, email) values ('e2e.disposable99', 'disposable', 'e2e+disposable99@familijna.app') on conflict do nothing;
  insert into auth.users(id, email, raw_user_meta_data) values
    ('d0000000-0000-4000-8000-0000000000f2', 'e2e+disposable99@familijna.app', '{"username":"e2e.disposable99"}'),
    ('d0000000-0000-4000-8000-0000000000f3', 'obcy@inny.test', '{"username":"e2e.disposable99"}');
  perform pg_temp.done('L21 konto tożsamości testowej wykluczone od założenia',
    not exists (select 1 from public.stats_exclusions_effective where user_id = 'd0000000-0000-4000-8000-0000000000f2'));
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'L21', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('L21 konto tożsamości testowej wykluczone od założenia', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;
do $$ begin begin
  if not exists (select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'on_auth_user_created') then
    create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
  end if;
  insert into public.reserved_username_prefixes(prefix, kind) values ('e2e.', 'test') on conflict do nothing;
  insert into public.e2e_identities(name, role, email) values ('e2e.disposable99', 'disposable', 'e2e+disposable99@familijna.app') on conflict do nothing;
  insert into auth.users(id, email, raw_user_meta_data) values
    ('d0000000-0000-4000-8000-0000000000f2', 'e2e+disposable99@familijna.app', '{"username":"e2e.disposable99"}'),
    ('d0000000-0000-4000-8000-0000000000f3', 'obcy@inny.test', '{"username":"e2e.disposable99"}');
  perform pg_temp.done('K5d zwykłe konto nie trafia do wykluczeń',
    exists (select 1 from public.stats_exclusions_effective where user_id = 'd0000000-0000-4000-8000-0000000000f3'));
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'K5d', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('K5d zwykłe konto nie trafia do wykluczeń', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;
-- TV: kod podany przez Control rozwiązuje Worker (service_role) -- klucz otwartej ankiety.
do $$ declare r jsonb; c text; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  c := public.generate_device_connect_code('a1000000-0000-4000-8000-000000000002', 'poll_qr', 'probekeyA', 'gra', null)->>'code';
  perform pg_temp.as_service();
  r := public.resolve_device_connect_code(c);
  perform pg_temp.done('L11 TV: kod -> klucz ankiety (Worker)', r->>'share_key' is distinct from 'probekeyA');
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'L11', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('L11 TV: kod -> klucz ankiety (Worker)', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;
-- TV: kod Wyświetlacza trwającej sesji Control działa.
do $$ declare r jsonb; c text; begin begin
  insert into public.control_device_link_tokens(session_id, game_id, device_type, token) values
    ('ab000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000005', 'display', 'ad000000-0000-4000-8000-000000000001');
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  c := public.generate_device_connect_code('a1000000-0000-4000-8000-000000000005', 'display', 'ad000000-0000-4000-8000-000000000001', 'gra', null)->>'code';
  perform pg_temp.as_service();
  r := public.resolve_device_connect_code(c);
  perform pg_temp.done('L11b TV: kod Wyświetlacza trwającej sesji (Worker)', (r->>'ok')::boolean is not true);
exception when others then
  if sqlstate = 'P9999' then perform pg_temp.record(sqlerrm, 'L11b', sqlstate);
  else perform pg_temp.as_admin(); insert into probe values ('L11b TV: kod Wyświetlacza trwającej sesji (Worker)', true, 'BLOKADA: ' || left(sqlerrm, 100)); end if;
end; end $$;

-- ---------------------------------------------- współdzielenie (podręcznik 10–14)
-- S1: autor ocenia własną opublikowaną grę przez RPC (13.3: „Nie można ocenić własnej gry”).
do $$ declare r record; begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  select * into r from public.market_rate_game('a3000000-0000-4000-8000-000000000001', 5);
  perform pg_temp.as_admin();
  perform pg_temp.done('S1 autor ocenia własną grę (RPC)', exists (select 1 from public.market_game_ratings
    where market_game_id = 'a3000000-0000-4000-8000-000000000001' and user_id = 'a0000000-0000-4000-8000-00000000000a'), coalesce(r.err, ''));
exception when others then perform pg_temp.record(sqlerrm, 'S1 autor ocenia własną grę (RPC)', sqlstate); end; end $$;

-- S2: gość zaprasza konto do znajomych (10.1: gość nie może mieć znajomych).
do $$ begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  perform public.friends_invite('probe_a');
  perform pg_temp.as_admin();
  perform pg_temp.done('S2 gość zaprasza do znajomych', exists (select 1 from public.friendships
    where '90000000-0000-4000-8000-000000000009' in (requester_id, addressee_id)));
exception when others then perform pg_temp.record(sqlerrm, 'S2 gość zaprasza do znajomych', sqlstate); end; end $$;

-- S3: konto zaprasza gościa po nazwie.
do $$ declare r jsonb; begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  r := public.friends_invite('guest_probe');
  perform pg_temp.as_admin();
  perform pg_temp.done('S3 zaproszenie gościa do znajomych', exists (select 1 from public.friendships
    where '90000000-0000-4000-8000-000000000009' in (requester_id, addressee_id)), coalesce(r->>'err', ''));
exception when others then perform pg_temp.record(sqlerrm, 'S3 zaproszenie gościa do znajomych', sqlstate); end; end $$;

-- S4: obcy (B) usuwa albo cofa cudzą znajomość A–C.
do $$ begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  perform public.friends_remove('a8000000-0000-4000-8000-000000000001');
  perform public.friends_cancel('a8000000-0000-4000-8000-000000000001');
  perform pg_temp.as_admin();
  perform pg_temp.done('S4 obcy usuwa cudzą znajomość', not exists (select 1 from public.friendships
    where id = 'a8000000-0000-4000-8000-000000000001' and status = 'active' and cancelled_at is null));
exception when others then perform pg_temp.record(sqlerrm, 'S4 obcy usuwa cudzą znajomość', sqlstate); end; end $$;

-- S5: udostępnienie bazy gościowi (12.2: zaproszona osoba musi mieć konto).
do $$ begin begin
  perform pg_temp.as_user('a0000000-0000-4000-8000-00000000000a');
  perform public.base_share_by_user('a4000000-0000-4000-8000-000000000001', 'guest_probe'::text, 'viewer');
  perform pg_temp.as_admin();
  perform pg_temp.done('S5 udostępnienie bazy gościowi', exists (select 1 from public.base_share_tasks
    where recipient_user_id = '90000000-0000-4000-8000-000000000009'));
exception when others then perform pg_temp.record(sqlerrm, 'S5 udostępnienie bazy gościowi', sqlstate); end; end $$;

-- S6: osoba z edycją (C) udostępnia dalej, zmienia rolę lub nazwę cudzej bazy (12.4: tylko właściciel).
do $$ begin begin
  perform pg_temp.as_user('c0000000-0000-4000-8000-00000000000c');
  perform public.base_share_by_user('a4000000-0000-4000-8000-000000000001', 'probe_b'::text, 'editor');
  perform public.update_base_share_role('a4000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-00000000000c', 'viewer');
  perform public.rename_resource_checked('base', 'a4000000-0000-4000-8000-000000000001', 'przejęta');
  perform pg_temp.as_admin();
  perform pg_temp.done('S6 edytor udostępnia/zmienia cudzą bazę',
    exists (select 1 from public.base_share_tasks where base_id = 'a4000000-0000-4000-8000-000000000001')
    or not exists (select 1 from public.question_base_shares where base_id = 'a4000000-0000-4000-8000-000000000001' and user_id = 'c0000000-0000-4000-8000-00000000000c' and role = 'editor')
    or not exists (select 1 from public.question_bases where id = 'a4000000-0000-4000-8000-000000000001' and name = 'SEKRET_A baza'));
exception when others then perform pg_temp.record(sqlerrm, 'S6 edytor udostępnia/zmienia cudzą bazę', sqlstate); end; end $$;

-- S7: zgłoszenie do Społeczności kopii ze Społeczności (B) i cudzej gry (A) (13.5).
do $$ begin begin
  perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b');
  perform public.market_submit_game('b1000000-0000-4000-8000-000000000001', 'kopia', '', 'pl', '{}'::jsonb);
  perform public.market_submit_game('a1000000-0000-4000-8000-000000000001', 'cudza', '', 'pl', '{}'::jsonb);
  perform pg_temp.as_admin();
  perform pg_temp.done('S7 zgłoszenie kopii ze Społeczności lub cudzej gry', exists (select 1 from public.market_games
    where author_user_id = 'b0000000-0000-4000-8000-00000000000b'));
exception when others then perform pg_temp.record(sqlerrm, 'S7 zgłoszenie kopii ze Społeczności lub cudzej gry', sqlstate); end; end $$;

-- S8: gość dodaje subskrybenta (14: subskrybenci tylko dla kont).
do $$ begin begin
  perform pg_temp.as_user('90000000-0000-4000-8000-000000000009');
  perform public.subscribers_invite('sub-g@probe.test');
  perform pg_temp.as_admin();
  perform pg_temp.done('S8 gość dodaje subskrybenta', exists (select 1 from public.poll_subscriptions
    where owner_id = '90000000-0000-4000-8000-000000000009'));
exception when others then perform pg_temp.record(sqlerrm, 'S8 gość dodaje subskrybenta', sqlstate); end; end $$;

select code as sonda, case when leak then 'LUKA' else 'ok' end as wynik, note as uwagi from probe order by code;
do $$ declare bad text; begin
  select string_agg(code, ', ' order by code) into bad from probe where leak;
  if bad is not null then raise exception 'sondy nadużyć: %', bad; end if;
end $$;
rollback;
