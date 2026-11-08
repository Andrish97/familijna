-- Przegląd E24 (2026-11): relacje schematu public z prawami anon/authenticated i ryzykiem.
-- h: skrót nazwy (('x'||left(md5(relname),8))::bit(32)::int) -- dopasowanie lokalnie z schema.sql.
-- kind 1 tabela, 2 partycjonowana, 3 widok, 4 widok zmaterializowany, 5 obca. acl: bity 1/2/4/8 anon S/I/U/D, 16/32/64/128 authenticated S/I/U/D.
-- pol_sel_true / pol_write_true: polityki dla public/anon/authenticated z warunkiem true (SELECT/ALL vs INSERT/UPDATE/DELETE/ALL).
-- Wiersz tylko, gdy anon/authenticated ma prawo i (brak RLS albo polityka true albo widok bez security_invoker).
select ('x' || left(md5(c.relname::text), 8))::bit(32)::int as h,
  (case c.relkind when 'r' then 1 when 'p' then 2 when 'v' then 3 when 'm' then 4 else 5 end) as kind,
  c.relrowsecurity as rls,
  ((case when has_table_privilege('anon', c.oid, 'SELECT') then 1 else 0 end) + (case when has_table_privilege('anon', c.oid, 'INSERT') then 2 else 0 end) + (case when has_table_privilege('anon', c.oid, 'UPDATE') then 4 else 0 end) + (case when has_table_privilege('anon', c.oid, 'DELETE') then 8 else 0 end) + (case when has_table_privilege('authenticated', c.oid, 'SELECT') then 16 else 0 end) + (case when has_table_privilege('authenticated', c.oid, 'INSERT') then 32 else 0 end) + (case when has_table_privilege('authenticated', c.oid, 'UPDATE') then 64 else 0 end) + (case when has_table_privilege('authenticated', c.oid, 'DELETE') then 128 else 0 end)) as acl,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('SELECT', 'ALL') and coalesce(p.qual, 'true') = 'true' and p.roles && array['public', 'anon', 'authenticated']::name[]) as pol_sel_true,
  (select count(*) from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL') and (coalesce(p.qual, 'true') = 'true' and coalesce(p.with_check, 'true') = 'true') and p.roles && array['public', 'anon', 'authenticated']::name[]) as pol_write_true,
  coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on']::text[], false) as invoker
from pg_class c join pg_namespace s on s.oid = c.relnamespace
where s.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
  and (has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') or has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE'))
  and ((c.relkind in ('r', 'p', 'f') and not c.relrowsecurity)
    or (c.relkind in ('v', 'm') and not coalesce(c.reloptions::text[] && array['security_invoker=true', 'security_invoker=on']::text[], false))
    or exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname and p.roles && array['public', 'anon', 'authenticated']::name[] and coalesce(p.qual, 'true') = 'true' and coalesce(p.with_check, 'true') = 'true'))
