-- E29: stan skrzynki powiadomień push z ostatniej doby — same liczby (funkcja push_outbox_stats, 531)
select app = 'admin' as admin, events, waiting, delivered, failed from public.push_outbox_stats(24)
