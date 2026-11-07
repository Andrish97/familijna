\set ON_ERROR_STOP 1
-- Test migracji 521 (kolejka demo w bazie, pg_cron): przygotowanie jak w admin-demo-499.sql
-- (zlecenie aktualizacji i zmiana jednej kopii po podglądzie), potem CALL procedury —
-- wynik taki sam jak pętla admin_demo_apply_next w usłudze. Bez ROLLBACK (procedura robi COMMIT):
-- uruchamiać na bazie tymczasowej (sql-gate).
DO $$ BEGIN
 IF has_function_privilege('anon','admin_demo_run_queue(integer)','EXECUTE')
    OR has_function_privilege('authenticated','admin_demo_run_queue(integer)','EXECUTE') THEN RAISE EXCEPTION 'demo_queue_exposed'; END IF;
END $$;
CREATE TABLE public._t521(update_id uuid, gid uuid, bgid uuid);
DO $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 old jsonb; newer jsonb; preview jsonb; change jsonb; gid uuid; bgid uuid; bid uuid; r jsonb; n integer;
 base jsonb; logo jsonb; qs jsonb;
BEGIN
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(a,'demo-a@example.invalid','{}'),(b,'demo-b@example.invalid','{}'),(c,'demo-c@example.invalid','{}');
 SELECT jsonb_agg(jsonb_build_object('text','Pytanie '||i,'answers',jsonb_build_array(jsonb_build_object('text','Ręcznik','fixed_points',40),jsonb_build_object('text','Parasol','fixed_points',30),jsonb_build_object('text','Woda','fixed_points',22))) ORDER BY i) INTO qs FROM generate_series(1,10) i;
 old:=jsonb_build_object('game',jsonb_build_object('name','Demo testowe','type','prepared','state','draft'),'questions',qs,'votes','[]'::jsonb);
 INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','prepared',old) ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
 base:='{"base":{"name":"Baza demo"},"categories":[{"id":"a","parent_id":null,"name":"Folder","ord":1}],"tags":[{"id":"t","name":"Tag","color":"#fff","ord":1}],"questions":[{"id":"q","category_id":"a","ord":1,"payload":{"text":"Pytanie bazowe","answers":[]}}],"question_tags":[{"question_id":"q","tag_id":"t"}],"category_tags":[{"category_id":"a","tag_id":"t"}]}';
 INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','base',base) ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
 logo:=jsonb_build_object('name','Logo demo','kind','GLYPH','payload',jsonb_build_object('layers',jsonb_build_array(jsonb_build_object('color','main','rows',to_jsonb(array_fill(repeat(' ',30),ARRAY[10]))))));
 INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','logo_text',logo) ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
 PERFORM seed_demo_for_user(a,'pl');PERFORM seed_demo_for_user(b,'pl');PERFORM seed_demo_for_user(c,'pl');
 SELECT id INTO gid FROM games WHERE owner_id=a AND name='Demo testowe';
 SELECT id INTO bgid FROM games WHERE owner_id=b AND name='Demo testowe';
 IF public._demo_current_definition('game',gid)<>public._demo_template_definition('prepared',old) THEN RAISE EXCEPTION 'seed_game_definition_differs'; END IF;
 SELECT id INTO bid FROM question_bases WHERE owner_id=a AND name='Baza demo';
 IF public._demo_current_definition('base',bid)<>public._demo_template_definition('base',base) THEN RAISE EXCEPTION 'seed_base_definition_differs'; END IF;
 UPDATE questions SET text='Własna zmiana użytkownika' WHERE game_id=bgid AND ord=1;
 newer:=jsonb_set(old,'{game,name}','"Nowa gra demo"');
 preview:=admin_demo_preview('pl','prepared',newer);
 IF (preview->>'eligible')::int<>2 THEN RAISE EXCEPTION 'edited_copy_was_eligible'; END IF;
 change:=admin_demo_replace(gen_random_uuid(),'pl','prepared',newer,preview->>'revision');
 UPDATE games SET name='Zmiana po podglądzie' WHERE owner_id=c AND name='Demo testowe';
 INSERT INTO public._t521 VALUES((change->>'id')::uuid,gid,bgid);
END $$;
DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM admin_demo_targets WHERE status='queued') THEN RAISE EXCEPTION 'nothing_queued'; END IF; END $$;
CALL public.admin_demo_run_queue(5);
DO $$ DECLARE t record; BEGIN
 SELECT * INTO t FROM public._t521;
 IF EXISTS(SELECT 1 FROM admin_demo_targets WHERE status='queued' AND next_run_at<=now()) THEN RAISE EXCEPTION 'queue_not_drained'; END IF;
 IF (SELECT name FROM games WHERE id=t.gid)<>'Nowa gra demo' OR (SELECT name FROM games WHERE id=t.bgid)<>'Demo testowe' THEN RAISE EXCEPTION 'wrong_game_replacement'; END IF;
 IF NOT EXISTS(SELECT 1 FROM admin_demo_targets WHERE update_id=t.update_id AND status='edited') THEN RAISE EXCEPTION 'concurrent_edit_not_preserved'; END IF;
 IF NOT EXISTS(SELECT 1 FROM admin_demo_targets WHERE update_id=t.update_id AND status='updated') THEN RAISE EXCEPTION 'nothing_updated'; END IF;
END $$;
DO $$ BEGIN
 BEGIN CALL public.admin_demo_run_queue(0); RAISE EXCEPTION 'bad_args_accepted';
 EXCEPTION WHEN raise_exception THEN IF SQLERRM <> 'admin_demo_bad_args' THEN RAISE; END IF; END;
END $$;
DROP TABLE public._t521;
\echo 'admin-demo-cron-521: OK'
