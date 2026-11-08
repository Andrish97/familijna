-- Przegląd E24 (2026-11): domyślne prawa i inne schematy (same liczby/bool).
-- def_*: wpisy ALTER DEFAULT PRIVILEGES w public dające anon/authenticated prawa do nowych tabel (r) / funkcji (f).
-- fn_public_exec: funkcje public (dowolne) wykonywalne przez PUBLIC (bez REVOKE). definer_total: wszystkie SECURITY DEFINER w public.
-- rt_pol: polityki realtime.messages; graphql: rozszerzenie pg_graphql; st_pol_*: polityki storage.objects.
select
  (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'r' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) as def_tables,
  (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f' and a.grantee in ('anon'::regrole, 'authenticated'::regrole)) as def_funcs,
  (select count(*) from pg_default_acl d, aclexplode(d.defaclacl) a where d.defaclnamespace = 'public'::regnamespace and d.defaclobjtype = 'f' and a.grantee = 0) as def_funcs_public,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and has_function_privilege('anon', p.oid, 'execute')) as fn_anon_exec,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef) as definer_total,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('anon', p.oid, 'execute')) as definer_anon,
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prosecdef and not coalesce(array_to_string(p.proconfig, ',') ~ 'search_path', false)) as definer_no_sp,
  (select count(*) from pg_policies where schemaname = 'realtime') as rt_pol,
  (select count(*) from pg_policies where schemaname = 'realtime' and roles && array['public', 'anon']::name[]) as rt_pol_anon,
  exists (select 1 from pg_extension where extname = 'pg_graphql') as graphql,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects') as st_pol,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and roles && array['public', 'anon']::name[]) as st_pol_anon,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and roles && array['public', 'anon', 'authenticated']::name[] and coalesce(qual, '') || coalesce(with_check, '') !~ 'bucket_id') as st_pol_nobucket,
  (select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects' and cmd = 'SELECT' and roles && array['public', 'anon']::name[] and coalesce(qual, '') !~ '(auth\.uid|owner|foldername)') as st_sel_anon_open,
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') and not c.relrowsecurity) as tables_no_rls,
  (select count(*) from pg_roles where rolname in ('anon', 'authenticated') and rolbypassrls) as bypassrls
