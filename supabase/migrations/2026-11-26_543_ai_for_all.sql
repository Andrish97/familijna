-- E30: koniec etapu próbnego (zgoda użytkownika 2026-11-26 po zielonych
-- testach kontrolnych): czat AI i asystent Familijnej dla wszystkich kont
-- zarejestrowanych. Wyłączyć albo zawęzić można w panelu admina („Czat AI”).
UPDATE public.ai_limits SET chat_audience = 'all', builtin_audience = 'all' WHERE id = 1;
