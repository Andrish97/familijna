<<<<<<< HEAD
import { sb } from "./supabase.js?v=v2026-11-05T23344";
import { t } from "../../translation/translation.js?v=v2026-11-05T23344";
=======
import { sb } from "./supabase.js?v=v2026-11-05T23344";
import { t } from "../../translation/translation.js?v=v2026-11-05T23344";
>>>>>>> origin/main

// Wstępne sprawdzenie; zapis profilu nadal rozstrzyga konflikt w bazie.
export async function ensureUsernameAvailable(username) {
  const { data: taken, error } = await sb().rpc("username_taken", { p_username: username });
  if (error) throw error;
  if (taken) throw new Error(t("auth.errUsernameTaken"));
}
