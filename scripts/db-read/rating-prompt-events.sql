-- Zdarzenia prośby o ocenę (546): liczby z ostatnich 7 dni, osobno konta testowe.
SELECT count(*) FILTER (WHERE NOT test_account) AS zdarzenia_7d,
       count(*) FILTER (WHERE NOT test_account AND outcome = 'shown') AS pokazania_7d,
       count(*) FILTER (WHERE NOT test_account AND outcome = 'sent') AS wyslane_7d,
       count(*) FILTER (WHERE test_account) AS testowe_7d,
       max(created_at) AS ostatnie
FROM public.app_rating_prompt_events
WHERE created_at > now() - interval '7 days'
