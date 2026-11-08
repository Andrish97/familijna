// Teksty maili żyją w tłumaczeniach strony (translation/<lang>/server.js,
// sekcja `authEmail`). Funkcja pobiera je ze strony w trakcie działania —
// bez kopii w repo/deployu. Gdy strona leży, a w pamięci nie ma jeszcze
// żadnej wersji, wysyłka kończy się błędem (linki w mailu i tak prowadzą na stronę).

export type EmailLang = "pl" | "en" | "uk";
export type EmailType = "signup" | "guest_migrate" | "recovery" | "email_change" | "email_change_notice" | "password_changed_notice";

export type CopyBlock = {
  subject: string;
  subtitle: string;
  title: string;
  desc: string;
  btn: string;
  ignore: string;
  copyHint: string;
  linkLabel?: string;
  footer: string;
  // Skąd wzięto teksty, np. "authEmail.recovery@en" — trafia do <meta> w mailu,
  // żeby test e2e mógł potwierdzić, że mail powstał z tłumaczeń strony.
  source: string;
};

const TYPE_KEYS: Record<EmailType, string> = {
  signup: "signup",
  guest_migrate: "guestMigrate",
  recovery: "recovery",
  email_change: "emailChange",
  email_change_notice: "emailChangeNotice",
  password_changed_notice: "passwordChangedNotice",
};

const REQUIRED_FIELDS: (keyof CopyBlock)[] = [
  "subject", "subtitle", "title", "desc", "btn", "ignore", "copyHint", "footer",
];

const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 5000;

// Stały, zaufany origin — NIE redirect_to z payloadu, bo pobrany plik jest wykonywany.
function translationsOrigin(): string {
  const raw = String(Deno.env.get("TRANSLATIONS_ORIGIN") || Deno.env.get("SITE_URL") || "").trim();
  if (raw) {
    try {
      return new URL(raw).origin;
    } catch {
      console.warn("[send-email] invalid TRANSLATIONS_ORIGIN/SITE_URL (ignored)");
    }
  }
  return "https://www.familijna.app";
}

type CacheEntry = { dict: Record<string, unknown>; at: number };
const globalAny = globalThis as unknown as { __familijna_email_dict?: Map<EmailLang, CacheEntry> };
const cache: Map<EmailLang, CacheEntry> =
  globalAny.__familijna_email_dict || (globalAny.__familijna_email_dict = new Map());

// translation/<lang>/server.js to `const xx = { ... }; export default xx;` bez importów.
function evalTranslationModule(code: string): Record<string, unknown> {
  const body = code.replace(/export\s+default\s+([A-Za-z_$][\w$]*)\s*;?/, "return $1;");
  if (body === code) throw new Error("translation module has no `export default`");
  const dict = new Function(body)();
  if (!dict || typeof dict !== "object") throw new Error("translation module did not return an object");
  return dict as Record<string, unknown>;
}

async function fetchDict(lang: EmailLang): Promise<Record<string, unknown>> {
  const url = `${translationsOrigin()}/shared/translation/${lang}/server.js?t=${Date.now()}`;
  const res = await fetch(url, {
    headers: { accept: "text/javascript, application/javascript, */*" },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const dict = evalTranslationModule(await res.text());
  // Stara wersja strony (np. tuż po deployu) — nie cache'ujemy jej.
  if (!dict.authEmail || typeof dict.authEmail !== "object") {
    throw new Error(`no authEmail section in ${url}`);
  }
  return dict;
}

async function loadDict(lang: EmailLang): Promise<Record<string, unknown>> {
  const hit = cache.get(lang);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.dict;
  try {
    const dict = await fetchDict(lang);
    cache.set(lang, { dict, at: Date.now() });
    return dict;
  } catch (err) {
    if (hit) {
      console.warn("[send-email] translation fetch failed, using stale cache", { lang, err: String(err) });
      return hit.dict;
    }
    throw new Error(`Cannot load email translations (${lang}): ${String(err)}`);
  }
}

function pickBlock(dict: Record<string, unknown>, type: EmailType): CopyBlock | null {
  const section = (dict.authEmail as Record<string, unknown> | undefined)?.[TYPE_KEYS[type]];
  if (!section || typeof section !== "object") return null;
  const block = section as Record<string, unknown>;
  for (const f of REQUIRED_FIELDS) {
    if (typeof block[f] !== "string" || !block[f]) return null;
  }
  return block as unknown as CopyBlock;
}

export async function getEmailCopy(type: EmailType, lang: EmailLang): Promise<CopyBlock> {
  const block = pickBlock(await loadDict(lang), type);
  if (block) return { ...block, source: `authEmail.${TYPE_KEYS[type]}@${lang}` };
  if (lang !== "pl") {
    console.warn("[send-email] missing authEmail copy, falling back to pl", { type, lang });
    const plBlock = pickBlock(await loadDict("pl"), type);
    if (plBlock) return { ...plBlock, source: `authEmail.${TYPE_KEYS[type]}@pl` };
  }
  throw new Error(`Missing authEmail.${TYPE_KEYS[type]} in translations (${lang})`);
}
