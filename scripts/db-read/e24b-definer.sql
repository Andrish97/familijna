-- Przegląd E24 (2026-11): funkcje SECURITY DEFINER w public wykonywalne przez anon/authenticated.
-- h: skrót nazwy (('x'||left(md5(proname),8))::bit(32)::int), nargs: liczba argumentów -- dopasowanie lokalnie.
-- uid: treść sprawdza auth.uid()/auth.jwt()/auth.role(); adm: woła is_admin/service_role; sp: ustawiony search_path; trig: funkcja wyzwalacza.
select ('x' || left(md5(p.proname::text), 8))::bit(32)::int as h, p.pronargs::int as nargs,
  has_function_privilege('anon', p.oid, 'execute') as anon,
  has_function_privilege('authenticated', p.oid, 'execute') as auth,
  (p.prosrc ~* 'auth[.](uid|jwt|role)[ ]*[(]') as uid,
  (p.prosrc ~* '(is_admin|service_role)') as adm,
  coalesce(array_to_string(p.proconfig, ',') ~ 'search_path', false) as sp,
  (p.prorettype = 'trigger'::regtype) as trig
from pg_proc p join pg_namespace s on s.oid = p.pronamespace
where s.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
