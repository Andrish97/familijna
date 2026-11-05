// base-explorerjs/actions/run.js
// Jedna ścieżka wykonania akcji z rejestru — dla paska, menu, skrótów,
// przeciągania i gestów: widoczność → dostępność → wykonanie → komunikat.

import { actionById, actionState } from "./registry.js?v=v2026-11-05T23012";
import { alertModal } from "../../../../shared/js/core/modal.js?v=v2026-11-05T23012";
import { t } from "../../../../shared/translation/translation.js?v=v2026-11-05T23012";

// Powody, które ze skrótu klawiszowego warto powiedzieć głośno. Brak
// zaznaczenia czy pusty schowek przy skrócie po prostu nic nie robi (jak
// w Eksploratorze), a „tylko podgląd” i „nie w wynikach” tłumaczą, czemu
// znany skrót nie działa.
const LOUD_REASONS = new Set(["baseExplorer.reasons.readOnly", "baseExplorer.reasons.notHere"]);

export async function runAction(id, ctx) {
  const action = actionById(id);
  if (!action) return false;

  const st = actionState(action, ctx);
  if (!st.enabled) {
    // pasek i menu nie pozwalają kliknąć niedostępnej akcji; dociera tu
    // skrót klawiszowy albo gest
    const reason = st.visible ? st.reason : (ctx.canEdit ? "baseExplorer.reasons.notHere" : "baseExplorer.reasons.readOnly");
    if (reason && LOUD_REASONS.has(reason) && ctx.source !== "toolbar" && ctx.source !== "menu") {
      void alertModal({ text: t(reason) });
    }
    return false;
  }

  try {
    await action.run(ctx);
    return true;
  } catch (e) {
    console.error(e);
    void alertModal({ text: e?.userMessage || t(action.errorKey || "baseExplorer.errors.operationFailed") });
    return false;
  }
}
