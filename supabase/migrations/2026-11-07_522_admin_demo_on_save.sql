-- Aktualizacja kopii demo tylko po zapisie w panelu (decyzja właściciela 2026-11-07,
-- familijna-server/docs/demo-aktualizacja-plan.md). Bez procesu w tle i bez pg_cron:
--  * „Zapisz demo” w panelu przerabia kolejkę od razu (admin_demo_apply_batch, partiami);
--  * kopia zajęta (silnik blokad: edit_lock_blockers, logo razem z blokadą „logos”
--    właściciela, baza razem z blokadami jej pytań/folderów/tagów) czeka;
--  * czekająca kopia dostaje aktualizację przy końcu użycia (release_edit_lock)
--    albo przy następnym otwarciu (acquire_edit_lock_mode), zanim ktoś ją otworzy;
--  * przed zapisem zawsze sprawdzenie, że kopia jest identyczna z poprzednim wzorcem.
-- Kolejny zapis tego samego demo przejmuje czekające kopie (dotąd zostawały
-- na starszej wersji na zawsze): stary wpis „superseded”, nowy z expected_definition.
-- Usunięte: zadanie pg_cron i procedura z 521, pętla admin_demo_apply_next.
BEGIN;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron') THEN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='familijna_admin_demo_queue') THEN
   PERFORM cron.unschedule('familijna_admin_demo_queue');
  END IF;
 END IF;
END $$;
DROP PROCEDURE IF EXISTS public.admin_demo_run_queue(integer);
DROP FUNCTION IF EXISTS public.admin_demo_apply_next();

ALTER TABLE public.admin_demo_targets ADD COLUMN expected_definition jsonb;
ALTER TABLE public.admin_demo_targets DROP CONSTRAINT admin_demo_targets_status_check;
ALTER TABLE public.admin_demo_targets ADD CONSTRAINT admin_demo_targets_status_check
  CHECK (status IN ('queued','updated','edited','removed','failed','superseded'));
CREATE INDEX IF NOT EXISTS admin_demo_targets_queued_idx ON public.admin_demo_targets(kind, resource_id) WHERE status='queued';

-- Ten sam klucz serializacji co acquire_edit_lock_mode (logo dzieli klucz z „logos”).
CREATE FUNCTION public._demo_lock_key(p_kind text, p_id uuid) RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT CASE p_kind WHEN 'logo' THEN 'logos:'||(SELECT user_id FROM user_logos WHERE id=p_id)::text
                    ELSE p_kind||':'||p_id::text END
$$;

-- Zajęta według silnika blokad (wygasłe blokady nie przeszkadzają).
CREATE FUNCTION public._demo_in_use(p_kind text, p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT EXISTS (SELECT 1 FROM public.edit_lock_blockers(p_kind, p_id, 'exclusive', 'demo-update'))
  OR (p_kind='base' AND EXISTS (SELECT 1 FROM public.edit_locks l
       WHERE l.heartbeat_at > now() - public.edit_lock_ttl() AND (
        (l.resource_type='base_question' AND l.resource_id IN (SELECT id FROM qb_questions WHERE base_id=p_id)) OR
        (l.resource_type='base_folder' AND l.resource_id IN (SELECT id FROM qb_categories WHERE base_id=p_id)) OR
        (l.resource_type='base_tag' AND l.resource_id IN (SELECT id FROM qb_tags WHERE base_id=p_id)))))
$$;

-- Jedna kopia z kolejki. Zwraca: updated | edited | removed | waiting | failed | NULL (brak wpisu).
CREATE FUNCTION public._demo_apply_target(p_update uuid, p_resource uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE t admin_demo_targets; job admin_demo_updates; cur jsonb; owner uuid; key text;
BEGIN
 SELECT * INTO t FROM admin_demo_targets WHERE update_id=p_update AND resource_id=p_resource AND status='queued' FOR UPDATE SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT * INTO job FROM admin_demo_updates WHERE id=t.update_id;
 key := public._demo_lock_key(t.kind, t.resource_id);
 IF key IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended(key,0)); END IF;
 BEGIN
  IF t.kind='game' THEN SELECT owner_id INTO owner FROM games WHERE id=t.resource_id FOR UPDATE NOWAIT;
  ELSIF t.kind='base' THEN SELECT owner_id INTO owner FROM question_bases WHERE id=t.resource_id FOR UPDATE NOWAIT;
  ELSE SELECT user_id INTO owner FROM user_logos WHERE id=t.resource_id FOR UPDATE NOWAIT; END IF;
  cur := public._demo_current_definition(t.kind, t.resource_id);
  IF cur IS NULL THEN
   UPDATE admin_demo_targets SET status='removed',message='' WHERE update_id=t.update_id AND resource_id=t.resource_id; RETURN 'removed';
  END IF;
  IF cur IS DISTINCT FROM coalesce(t.expected_definition, job.old_definition) THEN
   UPDATE admin_demo_targets SET status='edited',message='' WHERE update_id=t.update_id AND resource_id=t.resource_id; RETURN 'edited';
  END IF;
  IF public._demo_in_use(t.kind, t.resource_id) THEN RAISE lock_not_available; END IF;
  PERFORM public._demo_write(t.kind, t.resource_id, job.slot, job.new_payload);
  UPDATE admin_demo_targets SET status='updated',message='' WHERE update_id=t.update_id AND resource_id=t.resource_id;
  RETURN 'updated';
 EXCEPTION WHEN lock_not_available THEN
  UPDATE admin_demo_targets SET message='Czeka: materiał jest używany; zaktualizuje się po zwolnieniu albo przy następnym otwarciu.'
   WHERE update_id=t.update_id AND resource_id=t.resource_id;
  RETURN 'waiting';
 WHEN OTHERS THEN
  UPDATE admin_demo_targets SET status='failed',message=left(SQLSTATE||': '||SQLERRM,200) WHERE update_id=t.update_id AND resource_id=t.resource_id;
  RETURN 'failed';
 END;
END $$;

-- Punkt zaczepienia silnika blokad: czekające aktualizacje zasobu (game/logo/base;
-- „logos” = wszystkie loga właściciela). Szybkie wyjście, gdy nic nie czeka.
CREATE FUNCTION public._demo_apply_pending(p_type text, p_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record;
BEGIN
 IF p_type NOT IN ('game','logo','logos','base') THEN RETURN; END IF;
 FOR r IN SELECT t.update_id, t.resource_id FROM admin_demo_targets t
   WHERE t.status='queued' AND (
    (p_type IN ('game','logo','base') AND t.kind=p_type AND t.resource_id=p_id) OR
    (p_type='logos' AND t.kind='logo' AND t.resource_id IN (SELECT id FROM user_logos WHERE user_id=p_id AND is_demo)))
   ORDER BY t.update_id LOOP
  PERFORM public._demo_apply_target(r.update_id, r.resource_id);
 END LOOP;
END $$;

-- Panel („Zapisz demo”): partia kolejki; p_after = ostatni przetworzony klucz,
-- żeby zajęte kopie nie blokowały przejścia dalej. Wynik: liczby i kursor.
CREATE FUNCTION public.admin_demo_apply_batch(p_limit integer DEFAULT 50, p_after_update uuid DEFAULT NULL, p_after_resource uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r record; st text; n jsonb := '{"updated":0,"edited":0,"removed":0,"waiting":0,"failed":0}'; last_u uuid; last_r uuid; cnt int := 0;
BEGIN
 IF p_limit < 1 OR p_limit > 200 THEN RAISE EXCEPTION 'admin_demo_bad_args'; END IF;
 FOR r IN SELECT update_id, resource_id FROM admin_demo_targets
   WHERE status='queued' AND (p_after_update IS NULL OR (update_id, resource_id) > (p_after_update, p_after_resource))
   ORDER BY update_id, resource_id LIMIT p_limit LOOP
  st := public._demo_apply_target(r.update_id, r.resource_id);
  IF st IS NOT NULL THEN n := jsonb_set(n, ARRAY[st], to_jsonb((n->>st)::int + 1)); END IF;
  last_u := r.update_id; last_r := r.resource_id; cnt := cnt + 1;
 END LOOP;
 RETURN n || jsonb_build_object('done', cnt < p_limit, 'after_update', last_u, 'after_resource', last_r,
  'queued', (SELECT count(*) FROM admin_demo_targets WHERE status='queued'));
END $$;

-- Zapis wzorca: jak w 499, plus przejęcie kopii czekających na starszą wersję tego demo.
CREATE OR REPLACE FUNCTION public.admin_demo_replace(p_request uuid, p_lang text, p_slot text, p_payload jsonb, p_revision text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE old jsonb; check_result jsonb; upd uuid; kind text; old_def jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('admin-demo',0));
 SELECT id INTO upd FROM admin_demo_updates WHERE request_id=p_request;
 IF upd IS NOT NULL THEN RETURN jsonb_build_object('ok',true,'id',upd,'already',true); END IF;
 SELECT payload INTO old FROM demo_template_data WHERE lang=p_lang AND slot=p_slot FOR UPDATE;
 IF old IS NULL OR encode(sha256(convert_to(old::text,'UTF8')),'hex') IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'demo_version_changed_refresh_preview'; END IF;
 check_result:=public.admin_demo_preview(p_lang,p_slot,p_payload);kind:=check_result->>'kind';
 IF check_result->'definition' IS NULL THEN RAISE EXCEPTION 'invalid_demo_payload'; END IF;
 old_def:=public._demo_template_definition(p_slot,old);
 INSERT INTO admin_demo_updates(request_id,lang,slot,old_payload,new_payload,old_definition) VALUES(p_request,p_lang,p_slot,old,p_payload,old_def) RETURNING id INTO upd;
 -- kopie czekające na starszą wersję tego demo: nowy wpis z ich oczekiwaną treścią
 INSERT INTO admin_demo_targets(update_id,kind,resource_id,expected_definition)
  SELECT upd,t.kind,t.resource_id,coalesce(t.expected_definition,u.old_definition)
  FROM admin_demo_targets t JOIN admin_demo_updates u ON u.id=t.update_id
  WHERE t.status='queued' AND u.lang=p_lang AND u.slot=p_slot AND u.id<>upd;
 UPDATE admin_demo_targets t SET status='superseded',message=''
  FROM admin_demo_updates u WHERE u.id=t.update_id AND t.status='queued' AND u.lang=p_lang AND u.slot=p_slot AND u.id<>upd;
 INSERT INTO admin_demo_targets(update_id,kind,resource_id)
  SELECT upd,kind,x.id FROM (SELECT id FROM games WHERE is_demo AND kind='game' UNION ALL SELECT id FROM user_logos WHERE is_demo AND kind='logo' UNION ALL SELECT id FROM question_bases WHERE is_demo AND kind='base') x
  WHERE public._demo_current_definition(kind,x.id)=old_def
  ON CONFLICT DO NOTHING;
 UPDATE demo_template_data SET payload=p_payload WHERE lang=p_lang AND slot=p_slot;
 RETURN jsonb_build_object('ok',true,'id',upd,'eligible',check_result->'eligible');
END $$;

-- Silnik blokad: dosłownie jak w schemacie, plus punkty zaczepienia demo (oznaczone 522).
CREATE OR REPLACE FUNCTION "public"."acquire_edit_lock_mode"("p_resource_type" "text", "p_resource_id" "uuid", "p_tab_id" "text", "p_context" "text" DEFAULT NULL::"text", "p_mode" "text" DEFAULT 'exclusive'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_uid uuid := auth.uid();
  v_exists boolean := false;
  v_key text;
  v_owner uuid;
  v_row public.edit_locks;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'not_authenticated');
  end if;
  if coalesce(trim(p_tab_id), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'missing_tab_id');
  end if;
  if p_mode not in ('exclusive', 'shared') then
    return jsonb_build_object('ok', false, 'error', 'unknown_mode');
  end if;
  if p_resource_type not in ('game', 'logo', 'logos', 'base', 'base_question', 'base_folder', 'base_tag') then
    return jsonb_build_object('ok', false, 'error', 'unknown_resource_type');
  end if;
  v_exists := case p_resource_type
    when 'game' then exists (select 1 from public.games where id = p_resource_id)
    when 'logo' then exists (select 1 from public.user_logos where id = p_resource_id)
    when 'logos' then p_resource_id = v_uid
    when 'base' then exists (select 1 from public.question_bases where id = p_resource_id)
    when 'base_question' then exists (select 1 from public.qb_questions where id = p_resource_id)
    when 'base_folder' then exists (select 1 from public.qb_categories where id = p_resource_id)
    when 'base_tag' then exists (select 1 from public.qb_tags where id = p_resource_id)
    else false
  end;
  if not v_exists then
    return jsonb_build_object('ok', false, 'error', 'gone');
  end if;
  if not public.can_edit_locked_resource(p_resource_type, p_resource_id) then
    return jsonb_build_object('ok', false, 'error', 'forbidden');
  end if;

  -- serializacja zajmowania w obrębie zasobu; logo i pula logo użytkownika
  -- dzielą jeden klucz, bo zasady zgodności łączą je ze sobą.
  if p_resource_type = 'logo' then
    select user_id into v_owner from public.user_logos where id = p_resource_id;
    v_key := 'logos:' || v_owner::text;
  elsif p_resource_type = 'logos' then
    v_key := 'logos:' || p_resource_id::text;
  else
    v_key := p_resource_type || ':' || p_resource_id::text;
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_key, 0));

  -- wygasłe trzymania innych kart tego zasobu znikają (zwalniają klucz
  -- wyłączny); wygasłe nie przeszkadzają też w edit_lock_blockers.
  delete from public.edit_locks
   where resource_type = p_resource_type
     and resource_id = p_resource_id
     and holder_tab_id <> p_tab_id
     and heartbeat_at < now() - public.edit_lock_ttl();

  select * into v_row
  from public.edit_lock_blockers(p_resource_type, p_resource_id, p_mode, p_tab_id)
  order by acquired_at
  limit 1;

  if found then
    return jsonb_build_object('ok', false, 'error', 'locked',
      'holder_user_id', v_row.holder_user_id, 'acquired_at', v_row.acquired_at,
      'blocker_type', v_row.resource_type, 'blocker_id', v_row.resource_id,  -- 479: + blocker_id
      'blocker_mode', v_row.mode, 'blocker_context', v_row.holder_context);
  end if;

  -- 522: otwarcie zasobu (nie odświeżenie własnej blokady) najpierw wpisuje
  -- czekającą aktualizację demo — w tej chwili nikt inny go nie trzyma.
  if not exists (select 1 from public.edit_locks
                  where resource_type = p_resource_type and resource_id = p_resource_id
                    and holder_tab_id = p_tab_id and heartbeat_at > now() - public.edit_lock_ttl()) then
    perform public._demo_apply_pending(p_resource_type, p_resource_id);
  end if;

  insert into public.edit_locks
    (resource_type, resource_id, holder_tab_id, holder_user_id, holder_context, mode, acquired_at, heartbeat_at)
  values
    (p_resource_type, p_resource_id, p_tab_id, v_uid, p_context, p_mode, now(), now())
  on conflict (resource_type, resource_id, holder_tab_id) do update
    set holder_user_id = excluded.holder_user_id,
        holder_context = excluded.holder_context,
        heartbeat_at = excluded.heartbeat_at,
        acquired_at = case
          when public.edit_locks.mode = excluded.mode
            then public.edit_locks.acquired_at
          else excluded.acquired_at
        end,
        mode = excluded.mode;

  return jsonb_build_object('ok', true, 'acquired', true);
end;
$$;

CREATE OR REPLACE FUNCTION "public"."release_edit_lock"("p_resource_type" "text", "p_resource_id" "uuid", "p_tab_id" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  delete from public.edit_locks
  where resource_type = p_resource_type
    and resource_id = p_resource_id
    and holder_tab_id = p_tab_id
    and holder_user_id = auth.uid();  -- 479: tylko własne

  -- 522: koniec użycia — czekająca aktualizacja demo, jeśli zasób jest już wolny.
  perform public._demo_apply_pending(p_resource_type, p_resource_id);

  return jsonb_build_object('ok', true);
end;
$$;

DO $$ DECLARE f text; BEGIN
 FOREACH f IN ARRAY ARRAY['public._demo_lock_key(text,uuid)','public._demo_in_use(text,uuid)','public._demo_apply_target(uuid,uuid)',
   'public._demo_apply_pending(text,uuid)','public.admin_demo_apply_batch(integer,uuid,uuid)','public.admin_demo_replace(uuid,text,text,jsonb,text)'] LOOP
  EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', f);
  EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', f);
 END LOOP;
END $$;
COMMIT;
