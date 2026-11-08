import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// E25 (familijna-server/docs/konta-testowe-plan.md §5): każda statystyka i lista panelu admina
// pomija konta testowe przez jeden widok stats_exclusions_effective
// (tożsamości e2e, app_metadata.e2e_role, goście testowi, wykluczenia ręczne).
const schema = readFileSync(new URL("../../supabase/schema.sql", import.meta.url), "utf8");

function functions() {
  const out = new Map();
  // Ciało kończy ten sam znacznik, którym się zaczyna ($$ albo $_$), także
  // w jednej linii z END (np. funkcje migracji 499).
  for (const m of schema.matchAll(/CREATE FUNCTION "public"\."([a-z0-9_]+)"\([\s\S]*?AS (\$[a-z_]*\$)[\s\S]*?\2;/g)) out.set(m[1], m[0]);
  return out;
}

// Funkcje o nazwach statystyk, które nie liczą użytkowników (z powodem).
const NOT_USER_STATS = new Map([
  ["sync_market_game_rating_stats", "trigger utrzymujący pamięć podręczną ocen gry, nie statystyka panelu"],
  ["push_outbox_stats", "E29: liczby wysyłek powiadomień push według zdarzenia (diagnostyka agent_reader), bez użytkowników"],
]);
// Funkcje panelu admina liczące użytkowników, bez „stats” w nazwie.
const ADMIN_USER_STATS = ["get_ratings_admin", "get_app_rating_stats", "get_maintenance_activity", "agent_mail_window_counts"];

test("statystyki panelu admina pomijają konta testowe przez stats_exclusions_effective", () => {
  const all = functions();
  const names = [...all.keys()].filter((name) => /^get_admin_|_stats($|_)/.test(name) && !NOT_USER_STATS.has(name));
  names.push(...ADMIN_USER_STATS);
  assert.ok(names.length >= 10, `za mało funkcji statystyk: ${names.join(", ")}`);
  const missing = names.filter((name) => !all.has(name) || !all.get(name).includes("stats_exclusions_effective"));
  assert.deepEqual(missing, [], "funkcje bez wykluczeń kont testowych");
});

test("widok wykluczeń rozpoznaje tożsamości e2e i e2e_role", () => {
  const view = schema.slice(schema.indexOf('CREATE VIEW "public"."stats_exclusions_effective"'));
  const body = view.slice(0, view.indexOf(";"));
  assert.match(body, /e2e_identities/);
  assert.match(body, /e2e_role/);
  assert.match(body, /is_test_guest/);
});
