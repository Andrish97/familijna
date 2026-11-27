-- Prośba o ocenę systemu (2 dni od rejestracji, „Później” -> 3 dni): oceny
-- (bez kont wykluczonych) i powracający użytkownicy, którzy mogli ją zobaczyć.
-- powracajacy_*: konto aktywne w oknie i aktywne też >= 2 dni wcześniej
-- (dolna granica uprawnionych; bez kont testowych i wykluczonych).
WITH r AS (
  SELECT r.user_id, r.created_at, r.from_guest FROM public.app_ratings r
  WHERE r.user_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = r.user_id)
), h AS (
  SELECT a.user_id, a.bucket FROM public.site_activity_hours a
  WHERE NOT EXISTS (SELECT 1 FROM public.stats_exclusions_effective e WHERE e.user_id = a.user_id)
), u AS (
  SELECT user_id, min(bucket) AS first_seen, max(bucket) AS last_seen FROM h GROUP BY user_id
)
SELECT (SELECT count(*) FROM r) AS oceny_razem,
       (SELECT count(*) FROM r WHERE created_at >= '2026-11-08') AS oceny_od_0811,
       (SELECT count(*) FROM r WHERE created_at >= '2026-11-08' AND from_guest) AS oceny_gosci_od_0811,
       (SELECT max(created_at) FROM r) AS ostatnia_ocena,
       (SELECT count(*) FROM r WHERE created_at >= '2026-11-08' AND user_id IS NOT NULL
          AND created_at > (SELECT min(bucket) FROM h WHERE h.user_id = r.user_id) + interval '2 days') AS oceny_po_2_dniach_aktywnosci,
       (SELECT count(*) FROM u WHERE last_seen >= '2026-11-08') AS uzytkownicy_od_0811,
       (SELECT count(*) FROM u WHERE last_seen >= '2026-11-10' AND first_seen <= last_seen - interval '2 days') AS powracajacy_od_1011,
       (SELECT count(*) FROM u WHERE last_seen >= now() - interval '7 days' AND first_seen <= last_seen - interval '2 days') AS powracajacy_7d,
       (SELECT min(bucket) FROM h) AS najstarsza_aktywnosc
