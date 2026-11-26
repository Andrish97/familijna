-- E30: Google nie udostępnia już gemini-2.5-flash-lite nowym kluczom
-- („no longer available to new users”, e2e ai-builtin 2026-11-26) — asystent
-- Familijnej na gemini-3.5-flash-lite (następca, ta sama klasa najtańszych).
-- Model dalej zmienia właściciel w panelu admina (admin_ai_limits_set).
ALTER TABLE public.ai_limits ALTER COLUMN model SET DEFAULT 'gemini-3.5-flash-lite';
UPDATE public.ai_limits SET model = 'gemini-3.5-flash-lite' WHERE id = 1 AND model = 'gemini-2.5-flash-lite';
