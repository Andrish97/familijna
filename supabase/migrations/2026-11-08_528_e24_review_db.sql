-- E24 przegląd 2026-11-08 (familijna-server/docs/bezpieczenstwo-audyt.md, R9 R10 R11 R19 R20).
-- Zgodna wstecz: front korzysta z tych samych sygnatur (poza nową funkcją R10).

-- R9: link udostępnienia bazy nie zdradza adresów (front czyta tylko status i odbiorcę).
CREATE OR REPLACE FUNCTION public.base_share_token_info(p_token text)
RETURNS TABLE(status text, base_id uuid, recipient_user_id uuid, recipient_email text, owner_id uuid, owner_email text, owner_username text)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$
  select
    t.status,
    t.base_id,
    t.recipient_user_id,
    null::text as recipient_email,
    t.owner_id,
    null::text as owner_email,
    op.username as owner_username
  from public.base_share_tasks t
  JOIN public.question_bases b ON b.id=t.base_id AND b.owner_id=t.owner_id
  left join public.profiles op on op.id = t.owner_id
  where t.token::text=p_token AND public._base_task_source_active(t)
  and (t.status not in ('pending','opened','declined') OR coalesce(t.declined_at+interval '30 days',t.created_at+interval '5 days')>now())
  limit 1;
$$;

-- R10 (krok 1): sprawdzenie „to adres właściciela zaproszenia” tylko po tokenie
-- zaproszenia; wynik: nazwa właściciela albo null (nigdy adres).
CREATE OR REPLACE FUNCTION public.poll_go_owner_email_blocked(p_token uuid, p_email text)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT nullif(p.username, '')
  FROM public.poll_subscriptions ps
  JOIN public.profiles p ON p.id = ps.owner_id
  WHERE ps.token = p_token
    AND lower(btrim(p.email)) = lower(btrim(coalesce(p_email, '')))
  LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.poll_go_owner_email_blocked(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.poll_go_owner_email_blocked(uuid, text) TO anon, authenticated, service_role;
-- Stara wyrocznia po UUID konta (stara wersja strony przy błędzie RPC po prostu pomija sprawdzenie).
DROP FUNCTION IF EXISTS public.poll_go_owner_email_match(uuid, text);

-- R20: funkcje polityk baz pytań odpowiadają tylko o zalogowanego (polityki
-- zawsze podają auth.uid()); bez wyroczni „czy konto X ma dostęp do bazy Y”.
CREATE OR REPLACE FUNCTION public.base_can_access(p_base_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off' AS $$
  select p_user_id is not null and p_user_id = auth.uid() and exists (
    select 1 from public.question_bases b
    where b.id = p_base_id
      and (b.owner_id = p_user_id
        or exists (select 1 from public.question_base_shares s where s.base_id = b.id and s.user_id = p_user_id))
  );
$$;

CREATE OR REPLACE FUNCTION public.base_can_edit(p_base_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off' AS $$
  select p_user_id is not null and p_user_id = auth.uid() and exists (
    select 1 from public.question_bases b
    where b.id = p_base_id
      and (b.owner_id = p_user_id
        or exists (select 1 from public.question_base_shares s
                   where s.base_id = b.id and s.user_id = p_user_id and s.role = 'editor'))
  );
$$;

CREATE OR REPLACE FUNCTION public.base_is_owner(p_base_id uuid, p_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public' SET row_security TO 'off' AS $$
  select p_user_id is not null and p_user_id = auth.uid() and exists (
    select 1 from public.question_bases b where b.id = p_base_id and b.owner_id = p_user_id
  );
$$;

-- R20: nieużywane przez stronę — tylko serwer.
REVOKE ALL ON FUNCTION public.polls_hub_anon_voters(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.polls_hub_anon_voters(uuid, text) TO service_role;

-- R19: martwe funkcje starej tabeli email_cooldowns (nowe cooldowny: mail_cooldown_*).
DROP FUNCTION IF EXISTS public.cooldown_email_get(text, text[]);
DROP FUNCTION IF EXISTS public.cooldown_email_release(text, text, integer);
DROP FUNCTION IF EXISTS public.cooldown_email_reserve(text, text, integer);

-- R11: nowe funkcje w public nie są już automatycznie wykonywalne przez klientów.
-- Funkcja wołana ze strony potrzebuje jawnego GRANT EXECUTE … TO anon/authenticated
-- (pilnuje zapadka tests/unit/migrationGrants.test.js).
DO $$
DECLARE r text;
BEGIN
  FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('postgres', 'supabase_admin') LOOP
    -- Supabase nadaje per schemat anon/authenticated; PUBLIC to domyślne prawo
    -- Postgresa, odbierane tylko globalnie (dotyczy nowych funkcji tej roli
    -- we wszystkich schematach — nowe rozszerzenie: jawne GRANT, gdy potrzebne).
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated', r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC', r);
    EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO service_role', r);
  END LOOP;
END $$;
