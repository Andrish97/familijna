import { sb } from "./supabase.js?v=v2026-11-08T23371";


// =======================================================
// Email notifications flag (global per user)
// email_notifications boolean not null default true
// =======================================================

export async function getUserEmailNotificationsFlag(userId) {
  if (!userId) throw new Error("getUserEmailNotificationsFlag: brak userId");

  const { data, error } = await sb().rpc("get_my_email_notifications", { p_user_id: userId });

  if (error) throw error;
  if (typeof data !== "boolean") throw new Error("invalid_notification_preference");
  return data;
}

export async function setUserEmailNotificationsFlag(userId, value) {
  if (!userId) throw new Error("setUserEmailNotificationsFlag: brak userId");

  const { error } = await sb().rpc("set_my_email_notifications", { p_user_id: userId, p_enabled: !!value });

  if (error) throw error;
}


// =======================================================
// iOS webapp prompt dismissed flag (global per user)
// ios_webapp_prompt_dismissed boolean not null default false
// =======================================================

export async function getUserIosWebappPromptDismissedFlag(userId) {
  if (!userId) throw new Error("getUserIosWebappPromptDismissedFlag: brak userId");

  // ensure row exists (first time -> defaults from DB)
  await sb()
    .from("user_flags")
    .upsert({ user_id: userId }, { onConflict: "user_id" });

  const { data, error } = await sb()
    .from("user_flags")
    .select("ios_webapp_prompt_dismissed")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  return !!data?.ios_webapp_prompt_dismissed;
}

export async function setUserIosWebappPromptDismissedFlag(userId, value) {
  if (!userId) throw new Error("setUserIosWebappPromptDismissedFlag: brak userId");

  const { error } = await sb()
    .from("user_flags")
    .upsert(
      { user_id: userId, ios_webapp_prompt_dismissed: !!value },
      { onConflict: "user_id" }
    );

  if (error) throw error;
}
