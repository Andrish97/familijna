-- Społeczność: ile gier i jak długo liczy się market_public_catalog (TTFB 2026-11-05: ~600 ms). Same liczby.
select
  (select count(*) from public.market_games where status = 'published' and slug is not null) as published,
  (select count(*) from public.market_games) as all_rows,
  (select coalesce(sum(octet_length(description)), 0) from public.market_games where status = 'published') as description_bytes,
  (select round(extract(epoch from (e.t1 - e.t0)) * 1000)
     from (select clock_timestamp() as t0, (select count(*) from public.market_public_catalog()) as n, clock_timestamp() as t1) e) as catalog_ms
