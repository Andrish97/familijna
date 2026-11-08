-- Fuzzer autoryzacji krzyżowej: zwykły użytkownik B i anonim wołają każdą
-- funkcję, którą na produkcji mogą wołać (prawa z scripts/db-read/acl-all.sql,
-- stan 2026-10-29), z identyfikatorami zasobów, adresem i kluczami słownika
-- użytkownika A (tests/sql/abuse-fixtures.sql). Wykrywa: zmianę wierszy A
-- (odcisk md5 wierszy z identyfikatorami A) i wyciek znaczników A w wyniku
-- (SEKRET_A, adres e-mail A). Każde wywołanie w podtransakcji, limit 1 s.
-- Lokalna baza wg docs/sql/local-db.md:
--   psql -h /var/tmp/pgfam -p 5499 -U postgres -d fam -f tests/sql/cross-user-fuzz.sql
-- Znane i zamierzone przypadki: lista „expected” na końcu (z uzasadnieniem).
\set ON_ERROR_STOP 1
begin;
-- 528 odbiera domyślne EXECUTE nowym funkcjom; pomocnicze pg_temp.* testu
-- wołane jako authenticated muszą je mieć (cofane razem z transakcją).
alter default privileges grant execute on functions to public;
create temp table probe(code text primary key, leak boolean, note text);
grant all on probe to public;
create function pg_temp.as_user(p uuid) returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', p::text, true);
  perform set_config('role', 'authenticated', true);
end $$;
create function pg_temp.as_anon() returns void language plpgsql as $$ begin
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;
create function pg_temp.as_admin() returns void language plpgsql as $$ begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;
insert into public.mail_cooldown_policies(action_key, scope, cooldown_seconds, enforce) values
  ('auth:guest_upgrade_email', 'pair', 3600, true), ('auth:reset_password', 'pair', 3600, true)
on conflict (action_key) do nothing;
\ir abuse-fixtures.sql

create temp table fz_list(role text, name text);
insert into fz_list select 'auth', unnest(array[
'_control2_device_event_view', '_control2_diag_key', '_control2_jnum', '_control2_record_prize_calculation', 
'_control2_sanitize_event', '_game_control_active', '_norm_email', '_poll_share', '_public_username', 
'_qb_assert_edit', '_qb_assert_folder', '_qb_assert_items', '_qb_assert_no_cycle', '_qb_folder_subtree', 
'_qb_insert_question_copies', '_qb_tag_key', '_qb_unique_folder_name', '_resource_clone_send_allowed', 
'_transfer_points', 'acquire_edit_lock', 'acquire_edit_lock_mode', 'acquire_edit_locks', 'are_friends', 
'badges_get', 'base_can_access', 'base_can_edit', 'base_declines_list_mine', 'base_is_owner', 
'base_share_accept', 'base_share_by_user', 'base_share_cancel_task', 'base_share_decline', 
'base_share_panel', 'base_share_resend', 'base_share_to_friend', 'base_share_token_info', 
'base_share_undo_decline', 'base_share_update_invite_role', 'bases_count_incoming_share_invites', 
'can_edit_locked_resource', 'cancel_my_email_change', 'contacts_list', 'control2_control_log', 
'control2_device_log', 'control2_net_ping', 'control2_owner_session_events', 'control2_session_ping', 
'control_device_broadcast_topic_valid', 'control_device_instance_heartbeat', 
'control_device_instance_register', 'control_device_instance_release', 'control_device_share_create', 
'control_device_share_create_by_lookup', 'control_device_share_preflight', 
'control_device_share_preflight_by_lookup', 'control_device_share_resolve', 'control_device_share_revoke', 
'control_device_share_to_friend', 'control_device_shares_list', 'control_devices_snapshot', 
'control_display_signal_topic_valid', 'control_game_cancel_for_settings', 'control_game_settings_status', 
'control_owner_topic_valid', 'control_runtime_device_link', 'control_runtime_session_touch', 
'control_runtime_session_touch_v2', 'cooldown_email_get', 'cooldown_email_release', 'cooldown_email_reserve', 
'cooldown_get', 'cooldown_release', 'cooldown_reserve', 'delete_resource_checked', 'display_auth', 
'display_logo_get_public', 'e2e_friendships_cleanup', 'e2e_marketplace_cleanup', 
'e2e_poll_mail_budget_cleanup', 'e2e_poll_subscriptions_cleanup', 'e2e_shared_devices_cleanup', 
'e2e_storage_cleanup_peek', 'e2e_subscriber_email_cleanup', 'edit_lock_absent_grace', 'edit_lock_ttl', 
'email_mark_confirmed', 'expire_edit_locks_absent', 'fam_answer_clean', 'fam_answer_invalid_chars', 
'fam_display_glyph_chars', 'fam_display_has_glyph', 'friend_invites_from_subscriptions', 'friends_accept', 
'friends_cancel', 'friends_invite', 'friends_list', 'friends_reject', 'friends_remove', 'friends_resend', 
'friends_token_info', 'friends_undo_reject', 'game_change_type', 'game_import_content', 
'game_import_package', 'game_question_delete', 'game_questions_renumber', 'game_reset_poll_for_edit', 
'game_state_buzzer_press', 'game_state_display_complete', 'game_state_display_is_ready', 'game_state_get', 
'game_state_set_lock', 'game_state_set_sound_muted', 'game_state_set_ui_lang', 'game_state_write', 
'game_validate', 'gen_connect_code', 'gen_contact_ticket_number', 'gen_random_bytes', 'gen_share_key', 
'generate_device_connect_code', 'get_app_rating_stats', 'get_email_intent_status', 
'get_my_email_notifications', 'get_poll_game', 'get_poll_preview', 'guest_cancel_migration', 
'guest_convert_account', 'guest_discard_current', 'guest_finalize_migration', 'guest_is_expired', 
'guest_stage_migration', 'guest_touch', 'host2_logo_get_public', 'initiate_email_change_intent', 
'is_base_owner', 'leave_shared_base', 'list_base_share_tasks_outgoing', 'list_base_shares', 
'list_shared_bases_ext', 'list_shared_devices_for_me', 'mail_cooldown_check', 'mail_cooldown_email_check', 
'mail_cooldown_email_reserve', 'mail_cooldown_reserve', 'market_add_to_library', 'market_browse', 
'market_content_canonical', 'market_content_key', 'market_content_revision', 'market_embedding_text', 
'market_find_similar_embeddings', 'market_find_similar_questions', 'market_game_by_slug', 
'market_game_detail', 'market_game_raters', 'market_games_build_questions_text', 
'market_games_compute_fingerprint', 'market_my_library', 'market_my_submissions', 'market_normalize_content', 
'market_payload_questions', 'market_public_catalog', 'market_rate_game', 'market_remove_archived_copy', 
'market_remove_from_library', 'market_submit_game', 'market_withdraw', 'my_display_themes', 'poll_abort', 
'poll_action', 'poll_anonymous_submit', 'poll_claim_email_records', 'poll_get_payload', 
'poll_go_global_unsubscribe', 'poll_go_resolve', 'poll_go_sub_decline', 
'poll_go_subscribe_email', 'poll_my_email', 'poll_open', 'poll_points_tally', 'poll_points_vote_batch', 
'poll_resume', 'poll_share_panel', 'poll_share_remind', 'poll_share_remove', 'poll_share_send', 'poll_state', 
'poll_stop', 'poll_sub_accept_email', 'poll_sub_decline', 'poll_sub_unsubscribe', 'poll_tally_source', 
'poll_task_decline', 'poll_task_done', 'poll_task_opened', 'poll_task_resolve', 'poll_task_voter_token', 
'poll_text_submit_batch', 'poll_text_tally_apply', 'poll_text_tally_draft_get', 'poll_text_tally_draft_save', 
'poll_vote_game', 'polls_hub_anon_voters', 'polls_hub_can_close', 'polls_hub_can_close_poll_points', 
'polls_hub_can_close_poll_text', 'polls_hub_subscriber_remove', 'polls_hub_subscriber_resend', 
'polls_hub_task_decline', 'polls_hub_tasks_mark_emailed', 'polls_vote_counts', 'qb_apply_tag_states', 
'qb_base_content', 'qb_copy_items', 'qb_create_folder', 'qb_create_question', 'qb_delete_items', 
'qb_delete_tags', 'qb_move_items', 'qb_question_tag_links', 'qb_rename_folder', 'qb_reorder_folders', 
'qb_restore_positions', 'qb_restore_tag_links', 'qb_restore_tags', 'qb_save_question', 'qb_save_tag', 
'qb_set_question_text', 'qb_set_tag_links', 'qb_trash_list', 'qb_trash_purge', 'qb_trash_restore', 
'release_edit_lock', 'release_edit_locks', 'rename_resource_checked', 'reserved_username_prefixes_list', 
'resolve_device_connect_code', 'resource_copy_badges', 'resource_copy_decide', 'resource_copy_go_resolve', 
'resource_copy_history', 'resource_copy_inbox', 'restore_my_demo', 'revoke_base_share', 
'set_my_email_notifications', 'set_poll_qr_lang', 'site_activity_ping', 'slugify', 'snake_log', 
'subscribers_invite', 'subscribers_list', 'tasks_list', 'unique_market_slug', 'update_base_share_role', 
'update_logo_checked', 'username_taken'
]);
insert into fz_list select 'anon', unnest(array[
'_control2_device_event_view', '_control2_diag_key', '_control2_jnum', '_control2_record_prize_calculation', 
'_control2_sanitize_event', '_game_control_active', '_norm_email', '_poll_share', '_public_username', 
'_qb_tag_key', '_resource_clone_send_allowed', '_transfer_points', 'acquire_edit_lock', 
'acquire_edit_lock_mode', 'base_can_access', 'base_can_edit', 'base_is_owner', 'base_share_by_user', 
'base_share_token_info', 'bases_count_incoming_share_invites', 'can_edit_locked_resource', 
'cancel_my_email_change', 'control2_device_log', 'control2_net_ping', 'control_device_broadcast_topic_valid', 
'control_device_instance_heartbeat', 'control_device_instance_register', 'control_device_instance_release', 
'control_device_realtime_claim_valid', 'control_device_share_resolve', 'control_display_signal_topic_valid', 
'control_owner_topic_valid', 'cooldown_email_get', 'cooldown_email_release', 'cooldown_email_reserve', 
'cooldown_get', 'cooldown_release', 'cooldown_reserve', 'delete_resource_checked', 'display_auth', 
'display_logo_get_public', 'e2e_poll_subscriptions_cleanup', 'e2e_shared_devices_cleanup', 'edit_lock_ttl', 
'email_mark_confirmed', 'fam_answer_clean', 'fam_answer_invalid_chars', 'fam_display_glyph_chars', 
'fam_display_has_glyph', 'friends_token_info', 'game_state_buzzer_press', 'game_state_display_complete', 
'game_state_display_is_ready', 'game_state_get', 'game_state_set_lock', 'game_state_set_sound_muted', 
'game_state_set_ui_lang', 'game_state_write', 'gen_connect_code', 'gen_contact_ticket_number', 
'gen_random_bytes', 'gen_share_key', 'generate_device_connect_code', 'get_app_rating_stats', 
'get_email_intent_status', 'get_poll_game', 'get_poll_preview', 'guest_cancel_migration', 
'guest_convert_account', 'guest_discard_current', 'guest_finalize_migration', 'guest_is_expired', 
'guest_stage_migration', 'guest_touch', 'host2_logo_get_public', 'initiate_email_change_intent', 
'is_base_owner', 'list_base_share_tasks_outgoing', 'list_base_shares', 'list_shared_bases_ext', 
'mail_cooldown_check', 'mail_cooldown_email_check', 'mail_cooldown_email_reserve', 'mail_cooldown_reserve', 
'market_add_to_library', 'market_browse', 'market_content_canonical', 'market_content_key', 
'market_content_revision', 'market_embedding_text', 'market_find_similar_embeddings', 
'market_find_similar_questions', 'market_game_by_slug', 'market_game_detail', 'market_game_raters', 
'market_games_build_questions_text', 'market_games_compute_fingerprint', 'market_my_submissions', 
'market_normalize_content', 'market_payload_questions', 'market_public_catalog', 'market_rate_game', 
'market_remove_from_library', 'market_withdraw', 'poll_action', 'poll_anonymous_submit', 
'poll_claim_email_records', 'poll_get_payload', 'poll_go_global_unsubscribe', 
'poll_go_resolve', 'poll_go_sub_decline', 'poll_go_subscribe_email', 'poll_my_email', 
'poll_points_vote_batch', 'poll_state', 'poll_sub_accept_email', 'poll_sub_decline', 'poll_sub_unsubscribe', 
'poll_task_decline', 'poll_task_done', 'poll_task_opened', 'poll_task_resolve', 'poll_task_voter_token', 
'poll_text_submit_batch', 'poll_vote_game', 'polls_hub_anon_voters', 'polls_hub_can_close', 
'polls_hub_can_close_poll_points', 'polls_hub_can_close_poll_text', 'polls_hub_subscriber_remove', 
'polls_hub_subscriber_resend', 'polls_hub_task_decline', 'polls_hub_tasks_mark_emailed', 'release_edit_lock', 
'rename_resource_checked', 'reserved_username_prefixes_list', 'resolve_device_connect_code', 
'resource_copy_badges', 'resource_copy_decide', 'resource_copy_go_resolve', 'resource_copy_history', 
'resource_copy_inbox', 'restore_my_demo', 'set_poll_qr_lang', 'slugify', 'snake_log', 'unique_market_slug', 
'update_logo_checked'
]);
grant all on fz_list to public;
create temp table fz(fn text, role text, args text, outcome text, detail text);
create temp table fz_stat(role text, result text);
grant all on fz_stat to public;
grant all on fz to public;

-- Odcisk wierszy A we wszystkich tabelach public (identyfikatory a0…ac, adresy A).
create function pg_temp.a_snapshot() returns jsonb language plpgsql as $$
declare t record; h text; out jsonb := '{}';
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind = 'r' order by 1 loop
    execute format('select md5(coalesce(string_agg(x::text, %L order by x::text), %L)) from public.%I x where x::text ~ %L',
      '|', '', t.relname, '(a[0-9a-c]000000-0000-4000-8000-|probe-a@probe\.test|sub-a@probe\.test)') into h;
    if h <> md5('') then out := out || jsonb_build_object(t.relname, h); end if;
  end loop;
  return out;
end $$;

-- Kandydaci na wartość parametru (tekst SQL), wg nazwy i typu.
create function pg_temp.cands(p_name text, p_type text, p_src text) returns text[] language plpgsql as $$
declare
  n text := lower(coalesce(p_name, ''));
  games text[] := array['''a1000000-0000-4000-8000-000000000001''', '''a1000000-0000-4000-8000-000000000002''', '''a1000000-0000-4000-8000-000000000005'''];
  ids text[] := array['''a0000000-0000-4000-8000-00000000000a''', '''a1000000-0000-4000-8000-000000000001''', '''a4000000-0000-4000-8000-000000000001''',
                      '''a7000000-0000-4000-8000-000000000001''', '''a9000000-0000-4000-8000-000000000001''', '''a8000000-0000-4000-8000-000000000001''',
                      '''ab000000-0000-4000-8000-000000000001''', '''a3000000-0000-4000-8000-000000000001''', '''aa000000-0000-4000-8000-000000000001'''];
  lits text[];
  u text[];
begin
  if p_type = 'uuid' or p_type = 'uuid[]' then
    u := case
      when n ~ 'game' then games
      when n ~ 'market' then array['''a3000000-0000-4000-8000-000000000001''', '''a3000000-0000-4000-8000-000000000003''']
      when n ~ 'base' then array['''a4000000-0000-4000-8000-000000000001''']
      when n ~ 'logo' then array['''a7000000-0000-4000-8000-000000000001''']
      when n ~ 'theme' then array['''ac000000-0000-4000-8000-000000000001''']
      when n ~ 'tag' then array['''a6000000-0000-4000-8000-000000000001''']
      when n ~ '(question|item|folder|categor|parent)' then array['''a5000000-0000-4000-8000-000000000001''', '''a2000000-0000-4000-8000-000000000101''']
      when n ~ 'answer' then array['''a2000000-0000-4000-8000-000000000101''']
      when n ~ 'task' then array['''a9000000-0000-4000-8000-000000000001''']
      when n ~ 'friend' then array['''a8000000-0000-4000-8000-000000000001''', '''a0000000-0000-4000-8000-00000000000a''']
      when n ~ 'sub' then array['''aa000000-0000-4000-8000-000000000001''']
      when n ~ 'session' then array['''ab000000-0000-4000-8000-000000000001''']
      when n ~ '(user|owner|uid|recipient|member|target|addressee|requester|actor|identity|account)' then array['''a0000000-0000-4000-8000-00000000000a''']
      else ids end;
    if p_type = 'uuid[]' then return array(select 'array[' || x || ']::uuid[]' from unnest(u) x); end if;
    return array(select x || '::uuid' from unnest(u) x);
  end if;
  if p_type in ('text', 'character varying') then
    if n ~ 'email|mail|login' then return array['''probe-a@probe.test''', '''probe_a''', 'null']; end if;
    if n ~ 'lang' then return array['''pl''']; end if;
    if n ~ 'role' then return array['''editor''', '''viewer''']; end if;
    if n ~ '(username|nick)' then return array['''probe_a''']; end if;
    if n ~ '(key|token|secret|code|hash)' then return array['''x''', 'null', '''probekeyA''']; end if;
    if n ~ '(kind|type|resource|action|op|mode|status|event|state|scope|what|variant|context|tab|device)' then
      select array_agg(distinct quote_literal(m[1])) into lits
      from regexp_matches(coalesce(p_src, ''), '''([a-z][a-z_]{2,29})''', 'g') m;
      lits := coalesce(lits[1:12], '{}');
      return array['''game''', '''base''', '''logo''', '''display'''] || lits;
    end if;
    if n ~ '(name|title|text|label|comment|note|message|body|description)' then return array['''zmieniona przez B''']; end if;
    return array['''x''', 'null'];
  end if;
  if p_type in ('jsonb', 'json') then
    return array['''{}''::' || p_type,
      '''{"id":"a1000000-0000-4000-8000-000000000001","game_id":"a1000000-0000-4000-8000-000000000001","base_id":"a4000000-0000-4000-8000-000000000001","user_id":"a0000000-0000-4000-8000-00000000000a","owner_id":"a0000000-0000-4000-8000-00000000000a","question_id":"a5000000-0000-4000-8000-000000000001","logo_id":"a7000000-0000-4000-8000-000000000001","task_id":"a9000000-0000-4000-8000-000000000001","ids":["a5000000-0000-4000-8000-000000000001"],"name":"zmieniona przez B","email":"probe-a@probe.test"}''::' || p_type,
      '''[{"id":"a5000000-0000-4000-8000-000000000001","question_id":"a2000000-0000-4000-8000-000000000101","answer_id":"a2000000-0000-4000-8000-000000000101"}]''::' || p_type];
  end if;
  if p_type in ('integer', 'bigint', 'smallint', 'numeric', 'real', 'double precision') then return array['1', '0']; end if;
  if p_type = 'boolean' then return array['true', 'false']; end if;
  if p_type like 'timestamp%' then return array['now() + interval ''1 day''']; end if;
  if p_type = 'text[]' then return array['array[''x'']::text[]', 'array[''probe-a@probe.test'']::text[]']; end if;
  if exists (select 1 from pg_type t where t.typname = p_type and t.typtype = 'e') then
    return array(select quote_literal(e.enumlabel) || '::' || p_type from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = p_type order by e.enumsortorder limit 2);
  end if;
  return array['null'];
end $$;

do $$
declare
  f record; base jsonb; after jsonb; i int; k int; nv int; args text; res text; cands text[][];
  c text[]; parts text[]; ch text; who uuid; leak boolean; lens int[];
begin
  base := pg_temp.a_snapshot();
  for f in
    select l.role, p.oid, p.proname, p.prosrc, coalesce(p.proargnames, '{}') as names,
           array(select format_type(t, null) from unnest(p.proargtypes::oid[]) t) as types
    from fz_list l join pg_proc p on p.proname = l.name join pg_namespace n on n.oid = p.pronamespace and n.nspname = 'public'
    where p.prokind = 'f' and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
    order by p.proname, p.oid, l.role
  loop
    -- warianty „zip”: k-ty kandydat każdego parametru (modulo liczba kandydatów)
    nv := 1; lens := '{}';
    for i in 1 .. coalesce(array_length(f.types, 1), 0) loop
      c := pg_temp.cands(f.names[i], f.types[i], f.prosrc);
      lens := lens || coalesce(array_length(c, 1), 1);
      nv := greatest(nv, coalesce(array_length(c, 1), 1));
    end loop;
    for k in 0 .. least(nv, 16) - 1 loop
      parts := '{}';
      for i in 1 .. coalesce(array_length(f.types, 1), 0) loop
        c := pg_temp.cands(f.names[i], f.types[i], f.prosrc);
        parts := parts || c[(k % lens[i]) + 1];
      end loop;
      args := array_to_string(parts, ', ');
      begin
        if f.role = 'anon' then perform pg_temp.as_anon(); else perform pg_temp.as_user('b0000000-0000-4000-8000-00000000000b'); end if;
        perform set_config('statement_timeout', '1000', true);
        execute format('select coalesce(string_agg(x::text, %L), %L) from public.%I(%s) x', ',', '', f.proname, args) into res;
        perform set_config('statement_timeout', '0', true);
        perform pg_temp.as_admin();
        after := pg_temp.a_snapshot();
        select string_agg(key, ' ') into ch from (
          select key from jsonb_each_text(base) b where after->>b.key is distinct from b.value
          union select key from jsonb_each_text(after) a where not base ? a.key) d;
        -- adres A to wyciek tylko, gdy nie przyszedł w argumentach
        leak := coalesce(res, '') ~ 'SEKRET_A'
             or (coalesce(res, '') ~ '(probe-a@probe\.test|sub-a@probe\.test)' and args !~ '(probe-a@probe\.test|sub-a@probe\.test)');
        raise exception using errcode = 'P9999', message = coalesce(ch, '') || '|' || leak::text;
      exception when others then
        perform pg_temp.as_admin();
        perform set_config('statement_timeout', '0', true);
        insert into fz_stat values (f.role, case when sqlstate = 'P9999' then 'wykonane' else 'odmowa/błąd' end);
        if sqlstate = 'P9999' then
          if split_part(sqlerrm, '|', 1) <> '' or split_part(sqlerrm, '|', 2) = 'true' then
            insert into fz values (f.proname, f.role, args,
              case when split_part(sqlerrm, '|', 1) <> '' then 'ZMIANA A' else 'WYCIEK A' end,
              split_part(sqlerrm, '|', 1));
          end if;
        end if;
      end;
    end loop;
  end loop;
end $$;

-- Zamierzone: funkcja z definicji działa na danych A, gdy B lub anonim zna
-- publiczny identyfikator albo dostał to od A (uzasadnienie w komentarzu).
create temp table fz_expected(fn text, role text, why text);
insert into fz_expected values
  ('__brak__', '', '');

select role, result, count(*) as wywolan from fz_stat group by 1, 2 order by 1, 2;
select fn, role, outcome, detail, left(args, 160) as args from fz
where not exists (select 1 from fz_expected e where e.fn = fz.fn and (e.role = '' or e.role = fz.role))
order by fn, role, outcome;
do $$ declare n int; begin
  select count(*) into n from fz where not exists (select 1 from fz_expected e where e.fn = fz.fn and (e.role = '' or e.role = fz.role));
  if n > 0 then raise exception 'fuzzer autoryzacji: % wywołań zmieniło dane A albo ujawniło je', n; end if;
end $$;
rollback;
