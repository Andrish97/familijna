-- 534 (E30): endpointy zapisu treści zamiast bezpośrednich zapisów do tabel
-- ze stron. Wspólne dla interfejsu i czatu AI (familijna-server/docs/czat-ai-plan.md,
-- decyzja 12): baza sama pilnuje właściciela, reguł edycji (game_rules_compute),
-- aktywnej rozgrywki, blokad innych kart (edit_lock_blockers) i limitów treści.
-- Migracja dodająca: stare zapisy ze stron działają dalej, strony przechodzą
-- na endpointy w kolejnym kroku.
--
--   game_create            — nowa gra (opcjonalnie od razu z pytaniami)
--   game_content_apply     — zestaw zmian treści gry w jednej transakcji
--   game_settings_save     — ustawienia gry z kontrolą równoczesnego zapisu
--   base_create            — nowa baza pytań
--   qb_import_folder       — folder w katalogu głównym bazy z pytaniami (atomowo)
--   logo_create            — nowe logo
--
-- Wynik zawsze {ok: true, …} albo {ok: false, error: <kod>, …}; kody błędów
-- są stałe (czyta je strona i czat).

BEGIN;

-- ---------------------------------------------------------------- pomocnicze

-- Czy gracz może teraz zmieniać treść gry: właściciel, reguły edycji, brak
-- rozgrywki, brak blokady innej karty. Zwraca NULL (można) albo wynik błędu.
-- Wiersz gry zostaje zablokowany (FOR UPDATE) do końca transakcji.
CREATE OR REPLACE FUNCTION public._game_edit_refusal(p_game_id uuid, p_tab_id text, p_reset boolean, p_content boolean DEFAULT true)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := auth.uid();
  g record;
  v_edit jsonb;
  b public.edit_locks;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  select id, type::text as type, status::text as status into g
  from public.games where id = p_game_id and owner_id = v_uid
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found_or_forbidden');
  end if;

  perform pg_advisory_xact_lock(hashtextextended('game:' || p_game_id::text, 0));
  select * into b from public.edit_lock_blockers('game', p_game_id, 'exclusive', p_tab_id) limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'blocker_context', b.holder_context, 'same_user', b.holder_user_id = v_uid);
  end if;

  if not p_content then
    return null;
  end if;
  if public._game_control_active(g.id) then
    return jsonb_build_object('ok', false, 'error', 'edit_blocked', 'code', 'controlActive');
  end if;
  v_edit := public.game_rules_compute(g.id, g.type, g.status)->'edit';
  if not coalesce((v_edit->>'ok')::boolean, false) then
    return jsonb_build_object('ok', false, 'error', 'edit_blocked', 'code', v_edit->>'code');
  end if;
  if coalesce((v_edit->>'needs_reset')::boolean, false) then
    if not coalesce(p_reset, false) then
      return jsonb_build_object('ok', false, 'error', 'needs_reset');
    end if;
    perform public._game_poll_reset(g.id);
  end if;
  return null;
end;
$$;
REVOKE ALL ON FUNCTION public._game_edit_refusal(uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;

-- Tekst pytania jak przy imporcie (NFC, bez skrajnych spacji, 100 znaków).
CREATE OR REPLACE FUNCTION public._game_question_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select btrim(left(btrim(normalize(coalesce(p, ''), NFC)), 100))
$$;
REVOKE ALL ON FUNCTION public._game_question_text(text) FROM PUBLIC, anon, authenticated;

-- Przesunięcie numeracji pytań od p_from o p_delta (dwa kroki — unikalne
-- (game_id, ord) i ord >= 1 nie pozwalają przesunąć w miejscu).
CREATE OR REPLACE FUNCTION public._game_questions_shift(p_game_id uuid, p_from int, p_delta int) RETURNS void
LANGUAGE sql SET search_path TO 'public' AS $$
  update public.questions set ord = ord + 1000000 where game_id = p_game_id and ord >= p_from;
  update public.questions set ord = ord - 1000000 + p_delta where game_id = p_game_id and ord >= 1000000;
$$;
REVOKE ALL ON FUNCTION public._game_questions_shift(uuid, int, int) FROM PUBLIC, anon, authenticated;

-- Punkty odpowiedzi zależnie od typu gry: tylko preparowana trzyma punkty.
CREATE OR REPLACE FUNCTION public._game_answer_points(p_type text, p jsonb) RETURNS int
LANGUAGE sql IMMUTABLE SET search_path TO 'public' AS $$
  select case when p_type = 'prepared' then public._transfer_points(coalesce(p, '0'::jsonb)) else 0 end
$$;
REVOKE ALL ON FUNCTION public._game_answer_points(text, jsonb) FROM PUBLIC, anon, authenticated;

-- Wstawienie odpowiedzi na pierwsze wolne miejsce (1–6). Pusty tekst po
-- oczyszczeniu albo brak miejsca — wyjątek z kodem (łapie go game_content_apply).
CREATE OR REPLACE FUNCTION public._game_answer_add(p_question_id uuid, p_type text, p_item jsonb) RETURNS uuid
LANGUAGE plpgsql SET search_path TO 'public' AS $$
declare
  v_ord int;
  v_txt text := public.fam_answer_clean(p_item->>'text');
  v_id uuid;
begin
  if p_type = 'poll_text' then
    raise exception 'answers_not_allowed' using errcode = 'P0001';
  end if;
  if v_txt = '' then
    raise exception 'empty_text' using errcode = 'P0001';
  end if;
  select min(n) into v_ord from generate_series(1, 6) n
   where not exists (select 1 from public.answers a where a.question_id = p_question_id and a.ord = n);
  if v_ord is null then
    raise exception 'too_many_answers' using errcode = 'P0001';
  end if;
  insert into public.answers (question_id, ord, text, fixed_points)
  values (p_question_id, v_ord, v_txt, public._game_answer_points(p_type, p_item->'points'))
  returning id into v_id;
  return v_id;
end;
$$;
REVOKE ALL ON FUNCTION public._game_answer_add(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------- gry

-- Zestaw zmian treści gry, wszystko albo nic. p_ops — tablica operacji:
--   {"op":"rename","name"}
--   {"op":"add_question","text","answers":[{"text","points"}],"position"}   (position: 1… ; brak = na koniec)
--   {"op":"update_question","question_id","text"}
--   {"op":"delete_question","question_id"}
--   {"op":"move_question","question_id","position"}
--   {"op":"set_answers","question_id","answers":[{"text","points"}]}        (zastępuje odpowiedzi)
--   {"op":"add_answer","question_id","text","points"}
--   {"op":"update_answer","answer_id","text","points"}                       (pola opcjonalne)
--   {"op":"delete_answer","answer_id"}
-- Punkty mają znaczenie tylko w grze preparowanej; ankieta tekstowa nie ma
-- odpowiedzi. p_reset = zgoda na wyzerowanie wyników zamkniętej ankiety
-- (needs_reset). Błąd operacji: {ok:false, error, op_index}.
CREATE OR REPLACE FUNCTION public.game_content_apply(p_game_id uuid, p_ops jsonb, p_tab_id text DEFAULT NULL, p_reset boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_refusal jsonb;
  v_type text;
  v_op jsonb;
  v_i int := 0;
  v_kind text;
  v_q uuid;
  v_a uuid;
  v_ord int;
  v_pos int;
  v_n int;
  v_txt text;
  v_results jsonb := '[]'::jsonb;
  v_res jsonb;
  v_item jsonb;
  v_name text;
  v_constraint text;
begin
  if jsonb_typeof(p_ops) is distinct from 'array' or jsonb_array_length(p_ops) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if jsonb_array_length(p_ops) > 300 then
    return jsonb_build_object('ok', false, 'error', 'too_many_ops');
  end if;
  v_refusal := public._game_edit_refusal(p_game_id, p_tab_id, p_reset);
  if v_refusal is not null then
    return v_refusal;
  end if;
  select type::text into v_type from public.games where id = p_game_id;

  begin
    for v_op in select x from jsonb_array_elements(p_ops) x loop
      v_i := v_i + 1;
      v_kind := v_op->>'op';
      v_res := jsonb_build_object('op', v_kind);

      if v_kind in ('update_question', 'delete_question', 'move_question', 'set_answers', 'add_answer') then
        select id, ord into v_q, v_ord from public.questions
         where id = nullif(v_op->>'question_id', '')::uuid and game_id = p_game_id;
        if not found then raise exception 'question_not_found' using errcode = 'P0001'; end if;
      elsif v_kind in ('update_answer', 'delete_answer') then
        select a.id, a.question_id into v_a, v_q from public.answers a
          join public.questions q on q.id = a.question_id
         where a.id = nullif(v_op->>'answer_id', '')::uuid and q.game_id = p_game_id;
        if not found then raise exception 'answer_not_found' using errcode = 'P0001'; end if;
      end if;

      if v_kind = 'rename' then
        v_name := left(btrim(coalesce(v_op->>'name', '')), 80);
        if v_name = '' then raise exception 'empty_text' using errcode = 'P0001'; end if;
        update public.games set name = v_name where id = p_game_id;

      elsif v_kind = 'add_question' then
        v_txt := public._game_question_text(v_op->>'text');
        if v_txt = '' then raise exception 'empty_text' using errcode = 'P0001'; end if;
        select count(*) into v_n from public.questions where game_id = p_game_id;
        v_pos := least(greatest(coalesce(nullif(v_op->>'position', '')::int, v_n + 1), 1), v_n + 1);
        if v_pos <= v_n then perform public._game_questions_shift(p_game_id, v_pos, 1); end if;
        insert into public.questions (game_id, ord, text) values (p_game_id, v_pos, v_txt) returning id into v_q;
        if jsonb_typeof(v_op->'answers') = 'array' then
          for v_item in select x from jsonb_array_elements(v_op->'answers') x loop
            perform public._game_answer_add(v_q, v_type, v_item);
          end loop;
        end if;
        v_res := v_res || jsonb_build_object('question_id', v_q, 'position', v_pos);

      elsif v_kind = 'update_question' then
        v_txt := public._game_question_text(v_op->>'text');
        if v_txt = '' then raise exception 'empty_text' using errcode = 'P0001'; end if;
        update public.questions set text = v_txt where id = v_q;

      elsif v_kind = 'delete_question' then
        delete from public.questions where id = v_q;
        perform public._game_questions_shift(p_game_id, v_ord + 1, -1);

      elsif v_kind = 'move_question' then
        select count(*) into v_n from public.questions where game_id = p_game_id;
        v_pos := least(greatest(coalesce(nullif(v_op->>'position', '')::int, v_ord), 1), v_n);
        if v_pos <> v_ord then
          update public.questions set ord = 2000000 where id = v_q;
          perform public._game_questions_shift(p_game_id, v_ord + 1, -1);
          perform public._game_questions_shift(p_game_id, v_pos, 1);
          update public.questions set ord = v_pos where id = v_q;
        end if;
        v_res := v_res || jsonb_build_object('position', v_pos);

      elsif v_kind = 'set_answers' then
        if v_type = 'poll_text' then raise exception 'answers_not_allowed' using errcode = 'P0001'; end if;
        if jsonb_typeof(v_op->'answers') is distinct from 'array' then
          raise exception 'invalid_payload' using errcode = 'P0001';
        end if;
        delete from public.answers where question_id = v_q;
        for v_item in select x from jsonb_array_elements(v_op->'answers') x loop
          perform public._game_answer_add(v_q, v_type, v_item);
        end loop;

      elsif v_kind = 'add_answer' then
        v_a := public._game_answer_add(v_q, v_type, v_op);
        v_res := v_res || jsonb_build_object('answer_id', v_a);

      elsif v_kind = 'update_answer' then
        if v_op ? 'text' then
          v_txt := public.fam_answer_clean(v_op->>'text');
          if v_txt = '' then raise exception 'empty_text' using errcode = 'P0001'; end if;
          update public.answers set text = v_txt where id = v_a;
        end if;
        if v_op ? 'points' then
          update public.answers set fixed_points = public._game_answer_points(v_type, v_op->'points') where id = v_a;
        end if;

      elsif v_kind = 'delete_answer' then
        delete from public.answers where id = v_a;

      else
        raise exception 'unknown_op' using errcode = 'P0001';
      end if;

      v_results := v_results || jsonb_build_array(v_res);
    end loop;

    update public.games set updated_at = now() where id = p_game_id;
  exception
    when sqlstate 'P0001' then
      return jsonb_build_object('ok', false, 'error', sqlerrm, 'op_index', v_i);
    when check_violation or not_null_violation or unique_violation or string_data_right_truncation
         or invalid_text_representation then
      get stacked diagnostics v_constraint = constraint_name;
      return jsonb_build_object('ok', false, 'error', 'invalid_content', 'op_index', v_i,
                                'constraint', nullif(v_constraint, ''));
  end;

  select count(*) into v_n from public.questions where game_id = p_game_id;
  return jsonb_build_object('ok', true, 'results', v_results, 'questions', v_n,
    'game', (select jsonb_build_object('id', g.id, 'name', g.name, 'type', g.type, 'status', g.status)
               from public.games g where g.id = p_game_id),
    'readiness', (select public.game_rules_compute(g.id, g.type::text, g.status::text)->'readiness'
                    from public.games g where g.id = p_game_id));
end;
$$;
REVOKE ALL ON FUNCTION public.game_content_apply(uuid, jsonb, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_content_apply(uuid, jsonb, text, boolean) TO authenticated;

-- Nowa gra w szkicu; p_questions jak w game_content_apply/add_question
-- (tablica {text, answers:[{text, points}]}). Nazwę podaje strona (tekst
-- domyślny z tłumaczeń).
CREATE OR REPLACE FUNCTION public.game_create(p_type text, p_name text, p_questions jsonb DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_ops jsonb;
  v_res jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if p_type is null or p_type not in ('prepared', 'poll_text', 'poll_points') then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  if p_questions is not null and jsonb_typeof(p_questions) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;

  insert into public.games (name, owner_id, type, status)
  values (v_name, v_uid, p_type::public.game_type, 'draft')
  returning id into v_id;

  if coalesce(jsonb_array_length(p_questions), 0) > 0 then
    select jsonb_agg(x || '{"op":"add_question"}'::jsonb - 'position') into v_ops
    from jsonb_array_elements(p_questions) x where jsonb_typeof(x) = 'object';
    v_res := public.game_content_apply(v_id, coalesce(v_ops, '[]'::jsonb), null, false);
    if not coalesce((v_res->>'ok')::boolean, false) then
      raise exception 'game_create:%', v_res::text using errcode = 'P0002';
    end if;
  end if;

  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name, 'type', p_type, 'status', 'draft',
    'questions', (select count(*) from public.questions where game_id = v_id));
exception
  when sqlstate 'P0002' then
    -- treść nie przeszła: gra też nie powstaje, wynik operacji jak z game_content_apply
    return (substring(sqlerrm from 13))::jsonb;
end;
$$;
REVOKE ALL ON FUNCTION public.game_create(text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_create(text, text, jsonb) TO authenticated;

-- Ustawienia gry: zapis tylko, gdy w bazie są wciąż p_expected (ten sam
-- warunek co dotychczasowy updateChecked strony), inaczej 'conflict'.
-- Ustawienia nie zależą od stanu ankiety; blokada innej karty — tak.
CREATE OR REPLACE FUNCTION public.game_settings_save(p_game_id uuid, p_expected jsonb, p_settings jsonb, p_tab_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_refusal jsonb;
  v_cur jsonb;
begin
  if jsonb_typeof(p_settings) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  v_refusal := public._game_edit_refusal(p_game_id, p_tab_id, false, false);
  if v_refusal is not null then
    return v_refusal;
  end if;
  select settings into v_cur from public.games where id = p_game_id;
  if v_cur is distinct from p_expected then
    return jsonb_build_object('ok', false, 'error', 'conflict');
  end if;
  update public.games set settings = p_settings where id = p_game_id;
  return jsonb_build_object('ok', true);
end;
$$;
REVOKE ALL ON FUNCTION public.game_settings_save(uuid, jsonb, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_settings_save(uuid, jsonb, jsonb, text) TO authenticated;

-- ---------------------------------------------------------------- bazy pytań

CREATE OR REPLACE FUNCTION public.base_create(p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := auth.uid();
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  r record;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  insert into public.question_bases (owner_id, name) values (v_uid, v_name)
  returning id, name, owner_id, created_at, updated_at into r;
  return jsonb_build_object('ok', true, 'id', r.id, 'name', r.name, 'owner_id', r.owner_id,
                            'created_at', r.created_at, 'updated_at', r.updated_at);
end;
$$;
REVOKE ALL ON FUNCTION public.base_create(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.base_create(text) TO authenticated;

-- Folder w katalogu głównym bazy z pytaniami, atomowo. Nazwa zajęta —
-- „Nazwa (2)”, „(3)”… (jak dotychczas na stronie). p_questions: tablica
-- {text, answers:[{text, fixed_points|points}]}. Treść sprawdza trigger
-- trg_guard_qb_question_text.
CREATE OR REPLACE FUNCTION public.qb_import_folder(p_base_id uuid, p_name text, p_questions jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path TO 'public' AS $$
declare
  v_base text := left(btrim(coalesce(p_name, '')), 80);
  v_name text;
  v_n int := 1;
  v_ord int;
  v_folder uuid;
  v_count int;
  v_suffix text;
begin
  perform public._qb_assert_edit(p_base_id);
  if v_base = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  if jsonb_typeof(p_questions) is distinct from 'array' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('qb_root:' || p_base_id::text, 0));
  v_name := v_base;
  while exists (select 1 from public.qb_categories c
                 where c.base_id = p_base_id and c.parent_id is null and btrim(c.name) = v_name) loop
    v_n := v_n + 1;
    if v_n >= 1000 then
      return jsonb_build_object('ok', false, 'error', 'name_taken');
    end if;
    v_suffix := ' (' || v_n || ')';
    v_name := left(v_base, greatest(1, 80 - char_length(v_suffix))) || v_suffix;
  end loop;

  select coalesce(max(ord), 0) + 1 into v_ord from public.qb_categories
   where base_id = p_base_id and parent_id is null;
  insert into public.qb_categories (base_id, parent_id, name, ord)
  values (p_base_id, null, v_name, v_ord) returning id into v_folder;

  insert into public.qb_questions (base_id, category_id, ord, payload)
  select p_base_id, v_folder, s.ord,
         jsonb_build_object(
           'text', coalesce(s.item->>'text', ''),
           'answers', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'text', coalesce(a.item->>'text', ''),
                      'fixed_points', public._transfer_points(coalesce(a.item->'fixed_points', a.item->'points', '0'::jsonb)))
                    order by a.ord)
               from jsonb_array_elements(case when jsonb_typeof(s.item->'answers') = 'array'
                                               then s.item->'answers' else '[]'::jsonb end)
                    with ordinality a(item, ord)), '[]'::jsonb))
  from jsonb_array_elements(p_questions) with ordinality s(item, ord);
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'folder_id', v_folder, 'name', v_name, 'questions', v_count);
end;
$$;
REVOKE ALL ON FUNCTION public.qb_import_folder(uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.qb_import_folder(uuid, text, jsonb) TO authenticated;

-- ---------------------------------------------------------------- logo

-- Nowe logo. Pula logo trzymana przez inną kartę (Control, ustawienia gry)
-- — 'locked', jak przy update_logo_checked. Nazwa zajęta — 'name_taken'.
CREATE OR REPLACE FUNCTION public.logo_create(p_name text, p_type text, p_payload jsonb, p_tab_id text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := auth.uid();
  v_name text := left(btrim(coalesce(p_name, '')), 80);
  v_id uuid;
  b public.edit_locks;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if v_name = '' then
    return jsonb_build_object('ok', false, 'error', 'empty_name');
  end if;
  if p_type is null or p_type not in ('GLYPH_30x10', 'PIX_150x70') then
    return jsonb_build_object('ok', false, 'error', 'invalid_type');
  end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  perform pg_advisory_xact_lock(hashtextextended('logos:' || v_uid::text, 0));
  select * into b from public.edit_lock_blockers('logos', v_uid, 'exclusive', p_tab_id) limit 1;
  if found then
    return jsonb_build_object('ok', false, 'error', 'locked', 'blocker_context', b.holder_context);
  end if;
  if exists (select 1 from public.user_logos where user_id = v_uid and name = v_name) then
    return jsonb_build_object('ok', false, 'error', 'name_taken');
  end if;
  insert into public.user_logos (user_id, name, type, payload)
  values (v_uid, v_name, p_type, p_payload) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'name', v_name);
end;
$$;
REVOKE ALL ON FUNCTION public.logo_create(text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.logo_create(text, text, jsonb, text) TO authenticated;

COMMIT;
