-- E29: stan skrzynki powiadomień push z ostatniej doby (same liczby, bez treści i adresów)
select
  (select count(*) from public.push_outbox where created_at > now() - interval '1 day') as events_24h,
  (select count(*) from public.push_outbox where created_at > now() - interval '1 day' and app = 'admin') as admin_events_24h,
  (select count(*) from public.push_outbox where created_at > now() - interval '1 day' and app = 'main') as app_events_24h,
  (select count(*) from public.push_outbox where created_at > now() - interval '1 day' and sent_at is not null) as sent_24h,
  (select count(*) from public.push_outbox where created_at > now() - interval '1 day' and sent_at is null) as waiting_24h,
  (select coalesce(sum(delivered), 0) from public.push_outbox where created_at > now() - interval '1 day') as delivered_24h,
  (select coalesce(sum(failed), 0) from public.push_outbox where created_at > now() - interval '1 day') as failed_24h,
  (select max(created_at) from public.push_outbox where app = 'admin' and event = 'test') as last_admin_test_at
