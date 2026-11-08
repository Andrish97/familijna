-- Przegląd E24 (2026-11): buckety Storage (wymaga SELECT na storage.buckets; przy braku prawa -- błąd, to też wynik).
-- h: skrót id bucketu (('x'||left(md5(id),8))::bit(32)::int); public: odczyt publicznym URL-em; lim_mb: limit rozmiaru; mime: lista typów ustawiona.
select ('x' || left(md5(b.id), 8))::bit(32)::int as h, b.public, (b.file_size_limit / 1048576)::int as lim_mb, (b.allowed_mime_types is not null) as mime
from storage.buckets b
