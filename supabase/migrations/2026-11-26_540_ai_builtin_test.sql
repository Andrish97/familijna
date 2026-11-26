-- E30: etap próbny wbudowanego czatu (decyzja użytkownika 2026-11-26) —
-- klucz Familijnej (Gemini) tylko dla kont testowych. Czat dalej widoczny
-- tylko dla nich (chat_audience = test). Na wszystkich przełącza właściciel
-- w panelu admina (sekcja „Czat AI”).
UPDATE public.ai_limits SET builtin_audience = 'test' WHERE id = 1 AND builtin_audience = 'off';
