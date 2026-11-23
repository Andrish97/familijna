-- 535 (E30): historia rozmów czatu AI na koncie (decyzja 4: na koncie,
-- nieużywane usuwane; decyzja 9: po 30 dniach; decyzja 5: bez gości).
-- Tabela dostępna tylko przez endpointy (RLS bez polityk + brak praw do
-- tabeli): ai_chat_list, ai_chat_get, ai_chat_save, ai_chat_delete.
-- history — historia w formacie dostawcy (zmiana dostawcy = nowa rozmowa).
-- Klucze API NIE trafiają do tej tabeli.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_chats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 120),
  provider text NOT NULL CHECK (provider ~ '^[a-z]{2,20}$'),
  model text NOT NULL DEFAULT '' CHECK (char_length(model) <= 120),
  history jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(history) = 'array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_chats_user_updated_idx ON public.ai_chats (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS ai_chats_updated_idx ON public.ai_chats (updated_at);
ALTER TABLE public.ai_chats ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_chats FROM PUBLIC, anon, authenticated;

-- Zalogowane konto zarejestrowane (nie gość) albo NULL.
CREATE OR REPLACE FUNCTION public._ai_chat_uid() RETURNS uuid
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'auth', 'pg_temp' AS $$
declare
  v_uid uuid := auth.uid();
  v_identity jsonb;
begin
  if v_uid is null then return null; end if;
  select to_jsonb(u) into v_identity from auth.users u where u.id = v_uid;
  if not public._account_is_registered(v_uid, v_identity) then return null; end if;
  return v_uid;
end;
$$;
REVOKE ALL ON FUNCTION public._ai_chat_uid() FROM PUBLIC, anon, authenticated;

-- Lista rozmów (bez historii), najnowsze pierwsze.
CREATE OR REPLACE FUNCTION public.ai_chat_list(p_limit int DEFAULT 50) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  return jsonb_build_object('ok', true, 'chats', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'title', c.title, 'provider', c.provider, 'model', c.model,
                                        'updated_at', c.updated_at) order by c.updated_at desc)
      from (select * from public.ai_chats where user_id = v_uid
             order by updated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 200)) c), '[]'::jsonb));
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_list(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_list(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_chat_get(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  c public.ai_chats;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  select * into c from public.ai_chats where id = p_id and user_id = v_uid;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  return jsonb_build_object('ok', true, 'id', c.id, 'title', c.title, 'provider', c.provider, 'model', c.model,
                            'history', c.history, 'updated_at', c.updated_at);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_get(uuid) TO authenticated;

-- Zapis rozmowy: p_id NULL = nowa. Historia do 2 MB; tytuł skracany do 120.
CREATE OR REPLACE FUNCTION public.ai_chat_save(p_id uuid, p_title text, p_provider text, p_model text, p_history jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
  v_id uuid;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  if jsonb_typeof(p_history) is distinct from 'array' or coalesce(p_provider, '') !~ '^[a-z]{2,20}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_payload');
  end if;
  if pg_column_size(p_history) > 2 * 1024 * 1024 then
    return jsonb_build_object('ok', false, 'error', 'too_large');
  end if;
  if p_id is null then
    insert into public.ai_chats (user_id, title, provider, model, history)
    values (v_uid, left(btrim(coalesce(p_title, '')), 120), p_provider, left(coalesce(p_model, ''), 120), p_history)
    returning id into v_id;
  else
    update public.ai_chats
       set title = left(btrim(coalesce(p_title, '')), 120), provider = p_provider,
           model = left(coalesce(p_model, ''), 120), history = p_history, updated_at = now()
     where id = p_id and user_id = v_uid
    returning id into v_id;
    if v_id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_save(uuid, text, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_save(uuid, text, text, text, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.ai_chat_delete(p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_uid uuid := public._ai_chat_uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'error', 'registered_account_required');
  end if;
  delete from public.ai_chats where id = p_id and user_id = v_uid;
  return jsonb_build_object('ok', true, 'deleted', found);
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chat_delete(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_chat_delete(uuid) TO authenticated;

-- Sprzątanie: rozmowy bez zmian od 30 dni (zadanie cron, codziennie).
CREATE OR REPLACE FUNCTION public.ai_chats_cleanup() RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
declare
  v_n int;
begin
  delete from public.ai_chats where updated_at < now() - interval '30 days';
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
REVOKE ALL ON FUNCTION public.ai_chats_cleanup() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE v_job bigint;
BEGIN
  IF to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE 'SELECT jobid FROM cron.job WHERE jobname = ''familijna_ai_chats_cleanup'' LIMIT 1' INTO v_job;
    IF v_job IS NOT NULL THEN PERFORM cron.unschedule(v_job); END IF;
    PERFORM cron.schedule('familijna_ai_chats_cleanup', '37 3 * * *', 'SELECT public.ai_chats_cleanup()');
  END IF;
END $$;

COMMIT;
