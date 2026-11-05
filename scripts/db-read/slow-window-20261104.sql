-- Spowolnienie produkcji 2026-11-04 23:26–23:36 UTC: przebiegi Lead Findera w oknie 22:30–00:30 (same liczby i daty).
-- (cron.job_run_details: brak dostępu agent_reader — odczyt przez familijna-server, zadanie diagnostyczne)
select r.started_at as start, r.finished_at as koniec,
       round(extract(epoch from (coalesce(r.finished_at, now()) - r.started_at))::numeric, 1) as sekundy,
       r.kind = 'review' as przeglad, r.search_queries, r.pages_fetched, r.ai_calls, r.errors
  from public.marketing_run_stats r
 where r.started_at < '2026-11-05 00:30+00' and coalesce(r.finished_at, now()) >= '2026-11-04 22:30+00'
 order by 1
