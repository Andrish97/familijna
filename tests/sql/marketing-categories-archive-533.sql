-- Migracja 533: archiwum kategorii, blokada usunięcia kategorii z kontaktami.
-- Lokalna baza wg docs/sql/local-db.md (schema.sql + 533).
\set ON_ERROR_STOP 1
begin;
insert into public.marketing_categories(id, name, is_active) values
  ('53300000-0000-4000-8000-0000000000c1', 'Stara', true),
  ('53300000-0000-4000-8000-0000000000c2', 'Pusta', true);
insert into public.marketing_verified_contacts(email, url, title, category_id)
values ('a@a.pl', 'https://a.pl', 'A', '53300000-0000-4000-8000-0000000000c1');
do $$ declare r record; begin
  -- archiwum wymaga wyłączenia wyszukiwania
  begin
    update public.marketing_categories set archived_at = now() where id = '53300000-0000-4000-8000-0000000000c1';
    raise exception 'archiwum z włączonym wyszukiwaniem przyjęte';
  exception when check_violation then null; end;
  update public.marketing_categories set archived_at = now(), is_active = false where id = '53300000-0000-4000-8000-0000000000c1';
  select * into r from public.marketing_categories_list() where id = '53300000-0000-4000-8000-0000000000c1';
  if r.archived_at is null or r.contacts <> 1 then raise exception 'lista: %', r; end if;
  -- kontakt zostaje z kategorią; usunąć się nie da
  begin
    delete from public.marketing_categories where id = '53300000-0000-4000-8000-0000000000c1';
    raise exception 'usunięto kategorię z kontaktami';
  exception when raise_exception then
    if sqlerrm <> 'marketing_category_has_contacts' then raise; end if;
  end;
  if (select category_id from public.marketing_verified_contacts where email = 'a@a.pl') is null then
    raise exception 'kontakt odpięty'; end if;
  delete from public.marketing_categories where id = '53300000-0000-4000-8000-0000000000c2';  -- bez kontaktów: można
  if has_function_privilege('anon', 'public.marketing_categories_list()', 'execute') then
    raise exception 'lista dostępna dla anon'; end if;
end $$;
rollback;
\echo 'marketing-categories-archive-533: OK'
