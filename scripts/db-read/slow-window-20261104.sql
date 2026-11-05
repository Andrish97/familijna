-- Spowolnienie produkcji 2026-11-04 23:26–23:36 UTC: co działało w oknie 23:00–00:00 (same liczby i daty).
-- Zadania pg_cron (jobid, czasy, czas trwania) dłuższe niż 1 s oraz przebiegi Lead Findera.
select 'cron' as zrodlo, d.jobid as id, d.start_time as start, d.end_time as koniec,
       round(extract(epoch from (d.end_time - d.start_time))::numeric, 1) as sekundy, (d.status = 'succeeded') as ok
  from cron.job_run_details d
 where d.start_time >= '2026-11-04 23:00+00' and d.start_time < '2026-11-05 00:00+00'
   and d.end_time - d.start_time > interval '1 second'
union all
select 'lead_finder', null, r.started_at, r.finished_at,
       round(extract(epoch from (coalesce(r.finished_at, now()) - r.started_at))::numeric, 1), r.errors = 0
  from public.marketing_run_stats r
 where r.started_at < '2026-11-05 00:00+00' and coalesce(r.finished_at, now()) >= '2026-11-04 23:00+00'
 order by 3
