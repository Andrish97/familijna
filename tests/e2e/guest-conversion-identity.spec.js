const { test, expect } = require("@playwright/test");
const { loginAsGuest } = require("./helpers/login");
const { serveBranchCode } = require("./helpers/branch-code");

test.use({ serviceWorkers: "block" });

test("edytowalne oznaczenie gościa nie zmienia roli ani ważności konta", async ({ page, context, request }) => {
  test.setTimeout(90_000);
  await serveBranchCode(context, { pages: ["account"] });
  // Konto gościa zakłada Worker (E24 R4) — próba podmiany oznaczenia w żądaniu strony.
  await page.route("**/_api/auth/guest", async (route) => {
    const body = route.request().postDataJSON() || {};
    body.data = { ...(body.data || {}), is_guest: false };
    await route.continue({ postData: JSON.stringify(body) });
  });
  let authInfo;
  try {
    await loginAsGuest(page, context);
    authInfo = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data } = await sb.auth.getSession();
      return { url: sb.supabaseUrl, key: sb.supabaseKey, token: data.session.access_token, id: data.session.user.id };
    });
    const result = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: { user } } = await sb.auth.getUser();
      const read = async () => {
        const { data, error } = await sb.from("profiles").select("is_guest,guest_expires_at").eq("id", user.id).single();
        if (error) throw error;
        return data;
      };
      const before = await read();
      const { data, error } = await sb.auth.updateUser({ data: { is_guest: false } });
      if (error) throw error;
      // GoTrue's update response may reflect its in-memory input. Read the
      // persisted identity independently instead of trusting that response.
      const { data: persisted, error: readError } = await sb.auth.getUser();
      if (readError) throw readError;
      return { before, after: await read(), metadataGuest: persisted.user.user_metadata.is_guest, anonymous: data.user.is_anonymous };
    });
    expect(result.before.is_guest).toBe(true);
    expect(Date.parse(result.before.guest_expires_at)).toBeGreaterThan(Date.now());
    expect(result.after).toEqual(result.before);
    expect(result.metadataGuest).toBe(true);
    expect(result.anonymous).toBe(true);
  } finally {
    if (authInfo) {
      const response = await request.post(`${authInfo.url}/functions/v1/delete-account`, {
        headers: { Authorization: `Bearer ${authInfo.token}`, apikey: authInfo.key },
      });
      expect(response.status(), "Usunięcie wyłącznie gościa tego testu").toBe(200);
    }
  }
});

test("gość nie może przypisać kontu niepotwierdzonego adresu przez dawne RPC", async ({ page, context, request }) => {
  test.setTimeout(90_000);
  await serveBranchCode(context, { pages: ["account"] });
  await loginAsGuest(page, context);
  let authInfo;
  try {
    authInfo = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data, error } = await sb.auth.getSession();
      if (error || !data.session) throw new Error("Brak sesji gościa");
      return { url: sb.supabaseUrl, key: sb.supabaseKey, token: data.session.access_token, id: data.session.user.id };
    });
    const result = await page.evaluate(async () => {
      const sb = window.__sbClient;
      const { data: before, error: beforeError } = await sb.from("profiles").select("is_guest,email").eq("id", (await sb.auth.getUser()).data.user.id).single();
      if (beforeError) throw beforeError;
      const { data, error } = await sb.rpc("guest_convert_account", { p_email: "unverified-guest352@example.invalid" });
      if (error) throw error;
      const { data: after, error: afterError } = await sb.from("profiles").select("is_guest,email").eq("id", (await sb.auth.getUser()).data.user.id).single();
      if (afterError) throw afterError;
      return { before, after, result: data };
    });
    expect(result.before.is_guest).toBe(true);
    expect(result.result).toEqual({ ok: false, error: "not_confirmed" });
    expect(result.after).toEqual(result.before);
  } finally {
    if (authInfo) {
      const response = await request.post(`${authInfo.url}/functions/v1/delete-account`, {
        headers: { Authorization: `Bearer ${authInfo.token}`, apikey: authInfo.key },
      });
      expect(response.status(), "Usunięcie wyłącznie gościa utworzonego przez ten test").toBe(200);
    }
  }
});
