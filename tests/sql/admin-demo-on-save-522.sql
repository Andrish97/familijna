\set ON_ERROR_STOP 1
-- Test migracji 522: aktualizacja demo tylko po zapisie w panelu, zajętość z silnika blokad,
-- aktualizacja przy zwolnieniu i przy następnym otwarciu, przejęcie przy kolejnym zapisie.
BEGIN;
DO $$
DECLARE a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); c uuid:=gen_random_uuid();
 old jsonb; newer jsonb; newest jsonb; preview jsonb; change jsonb; r jsonb; base jsonb; logo jsonb; qs jsonb;
 ga uuid; gb uuid; gc uuid; la uuid; lb uuid; ba uuid; bb uuid; qa uuid; rev text;
BEGIN
 IF to_regprocedure('public.admin_demo_apply_next()') IS NOT NULL OR to_regprocedure('public.admin_demo_run_queue(integer)') IS NOT NULL THEN RAISE EXCEPTION 'old_queue_runner_left'; END IF;
 IF has_function_privilege('anon','admin_demo_apply_batch(integer,uuid,uuid)','EXECUTE') OR has_function_privilege('authenticated','admin_demo_apply_batch(integer,uuid,uuid)','EXECUTE')
    OR has_function_privilege('authenticated','_demo_apply_pending(text,uuid)','EXECUTE') THEN RAISE EXCEPTION 'demo_exposed'; END IF;
 INSERT INTO auth.users(id,email,raw_user_meta_data) VALUES(a,'demo-a@example.invalid','{}'),(b,'demo-b@example.invalid','{}'),(c,'demo-c@example.invalid','{}');
 SELECT jsonb_agg(jsonb_build_object('text','Pytanie '||i,'answers',jsonb_build_array(jsonb_build_object('text','Ręcznik','fixed_points',40),jsonb_build_object('text','Parasol','fixed_points',30),jsonb_build_object('text','Woda','fixed_points',22))) ORDER BY i) INTO qs FROM generate_series(1,10) i;
 old:=jsonb_build_object('game',jsonb_build_object('name','Demo testowe','type','prepared','state','draft'),'questions',qs,'votes','[]'::jsonb);
 INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','prepared',old) ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
 base:='{"base":{"name":"Baza demo"},"categories":[{"id":"a","parent_id":null,"name":"Folder","ord":1}],"tags":[{"id":"t","name":"Tag","color":"#fff","ord":1}],"questions":[{"id":"q","category_id":"a","ord":1,"payload":{"text":"Pytanie bazowe","answers":[]}}],"question_tags":[{"question_id":"q","tag_id":"t"}],"category_tags":[{"category_id":"a","tag_id":"t"}]}';
 INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','base',base) ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
 logo:=jsonb_build_object('name','Logo demo','kind','GLYPH','payload',jsonb_build_object('layers',jsonb_build_array(jsonb_build_object('color','main','rows',to_jsonb(array_fill(repeat(' ',30),ARRAY[10]))))));
 INSERT INTO demo_template_data(lang,slot,payload) VALUES('pl','logo_text',logo) ON CONFLICT(lang,slot) DO UPDATE SET payload=excluded.payload;
 PERFORM seed_demo_for_user(a,'pl');PERFORM seed_demo_for_user(b,'pl');PERFORM seed_demo_for_user(c,'pl');
 SELECT id INTO ga FROM games WHERE owner_id=a AND name='Demo testowe';
 SELECT id INTO gb FROM games WHERE owner_id=b AND name='Demo testowe';
 SELECT id INTO gc FROM games WHERE owner_id=c AND name='Demo testowe';
 SELECT id INTO la FROM user_logos WHERE user_id=a AND is_demo AND name='Logo demo';
 SELECT id INTO lb FROM user_logos WHERE user_id=b AND is_demo AND name='Logo demo';
 SELECT id INTO ba FROM question_bases WHERE owner_id=a AND name='Baza demo';
 SELECT id INTO bb FROM question_bases WHERE owner_id=b AND name='Baza demo';
 SELECT id INTO qa FROM qb_questions WHERE base_id=ba LIMIT 1;

 -- Gra: A w Control (blokada gry), B wolna, C z wygasłą blokadą (zamknięta przeglądarka).
 INSERT INTO edit_locks(resource_type,resource_id,holder_tab_id,holder_user_id,holder_context,mode,acquired_at,heartbeat_at)
  VALUES('game',ga,'tab-a',a,'control','exclusive',now(),now()),
        ('game',gc,'tab-c',c,'editor','exclusive',now()-interval '1 hour',now()-interval '1 hour');
 newer:=jsonb_set(old,'{game,name}','"Nowa gra demo"');
 preview:=admin_demo_preview('pl','prepared',newer);
 change:=admin_demo_replace(gen_random_uuid(),'pl','prepared',newer,preview->>'revision');
 -- Bez zapisu w panelu nic się nie dzieje samo: kopie czekają w kolejce.
 IF (SELECT name FROM games WHERE id=gb)<>'Demo testowe' THEN RAISE EXCEPTION 'updated_without_batch'; END IF;
 r:=admin_demo_apply_batch(50,NULL,NULL);
 IF (SELECT name FROM games WHERE id=gb)<>'Nowa gra demo' THEN RAISE EXCEPTION 'free_copy_not_updated %',r; END IF;
 IF (SELECT name FROM games WHERE id=gc)<>'Nowa gra demo' THEN RAISE EXCEPTION 'expired_lock_blocked %',r; END IF;
 IF (SELECT name FROM games WHERE id=ga)<>'Demo testowe' THEN RAISE EXCEPTION 'busy_copy_overwritten'; END IF;
 IF (r->>'waiting')::int<1 OR (r->>'queued')::int<1 THEN RAISE EXCEPTION 'busy_not_waiting %',r; END IF;

 -- Drugi zapis tego demo, gdy A dalej czeka: A przechodzi do nowej aktualizacji.
 newest:=jsonb_set(old,'{game,name}','"Najnowsza gra demo"');
 SELECT encode(sha256(convert_to(payload::text,'UTF8')),'hex') INTO rev FROM demo_template_data WHERE lang='pl' AND slot='prepared';
 PERFORM admin_demo_replace(gen_random_uuid(),'pl','prepared',newest,rev);
 IF NOT EXISTS(SELECT 1 FROM admin_demo_targets WHERE update_id=(change->>'id')::uuid AND resource_id=ga AND status='superseded') THEN RAISE EXCEPTION 'not_superseded'; END IF;

 -- Koniec użycia (Control zwalnia blokadę) → A dostaje najnowszą wersję od razu.
 PERFORM set_config('request.jwt.claim.sub', a::text, true);
 PERFORM release_edit_lock('game',ga,'tab-a');
 IF (SELECT name FROM games WHERE id=ga)<>'Najnowsza gra demo' THEN RAISE EXCEPTION 'release_did_not_apply: %',(SELECT name FROM games WHERE id=ga); END IF;

 -- Logo: blokada „logos” właściciela (Control/ustawienia) chroni każde jego logo.
 INSERT INTO edit_locks(resource_type,resource_id,holder_tab_id,holder_user_id,holder_context,mode,acquired_at,heartbeat_at)
  VALUES('logos',a,'tab-a2',a,'control','shared',now(),now());
 SELECT encode(sha256(convert_to(payload::text,'UTF8')),'hex') INTO rev FROM demo_template_data WHERE lang='pl' AND slot='logo_text';
 PERFORM admin_demo_replace(gen_random_uuid(),'pl','logo_text',jsonb_set(logo,'{name}','"Logo nowe"'),rev);
 PERFORM admin_demo_apply_batch(50,NULL,NULL);
 IF (SELECT name FROM user_logos WHERE id=lb)<>'Logo nowe' THEN RAISE EXCEPTION 'free_logo_not_updated'; END IF;
 IF (SELECT name FROM user_logos WHERE id=la)<>'Logo demo' THEN RAISE EXCEPTION 'logos_lock_ignored'; END IF;
 -- Blokada wygasa bez zdarzenia (zamknięta karta), potem następne otwarcie edytora logo:
 UPDATE edit_locks SET heartbeat_at=now()-interval '1 hour' WHERE holder_tab_id='tab-a2';
 r:=acquire_edit_lock_mode('logo',la,'tab-a3','logo-editor','exclusive');
 IF NOT (r->>'ok')::boolean THEN RAISE EXCEPTION 'acquire_failed %',r; END IF;
 IF (SELECT name FROM user_logos WHERE id=la)<>'Logo nowe' THEN RAISE EXCEPTION 'open_did_not_apply'; END IF;

 -- Baza: blokada pytania (edycja w Eksploratorze) chroni całą bazę.
 INSERT INTO edit_locks(resource_type,resource_id,holder_tab_id,holder_user_id,holder_context,mode,acquired_at,heartbeat_at)
  VALUES('base_question',qa,'tab-a4',a,'explorer','exclusive',now(),now());
 SELECT encode(sha256(convert_to(payload::text,'UTF8')),'hex') INTO rev FROM demo_template_data WHERE lang='pl' AND slot='base';
 PERFORM admin_demo_replace(gen_random_uuid(),'pl','base',jsonb_set(base,'{base,name}','"Baza nowa"'),rev);
 PERFORM admin_demo_apply_batch(50,NULL,NULL);
 IF (SELECT name FROM question_bases WHERE id=bb)<>'Baza nowa' THEN RAISE EXCEPTION 'free_base_not_updated'; END IF;
 IF (SELECT name FROM question_bases WHERE id=ba)<>'Baza demo' THEN RAISE EXCEPTION 'question_lock_ignored'; END IF;
 -- Otwarcie Eksploratora przez kogoś innego, gdy pytanie wciąż edytowane: dalej czeka.
 PERFORM release_edit_lock('base_question',qa,'tab-a4');
 IF (SELECT name FROM question_bases WHERE id=ba)<>'Baza demo' THEN RAISE EXCEPTION 'child_release_should_not_rewrite_base'; END IF;
 r:=acquire_edit_lock_mode('base',ba,'tab-a5','explorer','shared');
 IF (SELECT name FROM question_bases WHERE id=ba)<>'Baza nowa' THEN RAISE EXCEPTION 'base_open_did_not_apply'; END IF;

 -- Kopia edytowana przez użytkownika nigdy nie jest nadpisywana.
 IF NOT EXISTS(SELECT 1 FROM admin_demo_targets WHERE status='queued') THEN NULL; END IF;
 IF EXISTS(SELECT 1 FROM admin_demo_targets WHERE status='queued') THEN RAISE EXCEPTION 'queue_left %',(SELECT count(*) FROM admin_demo_targets WHERE status='queued'); END IF;
 RAISE NOTICE 'admin-demo-on-save-522: OK';
END $$;
ROLLBACK;
