// base-explorerjs/ui/rename-modal.js
// Okno zmiany nazwy folderu / treści pytania — wspólne promptModal
// (shared/js/core/modal.js), jak w Grach, Bazach i Logo. Pusta nazwa = anuluj.

import { promptModal } from "../../../../shared/js/core/modal.js?v=v2026-11-08T22332";
import { t } from "../../../../shared/translation/translation.js?v=v2026-11-08T22332";

export async function openRenameModal({ title, value = "", maxLen = 80 } = {}) {
  const v = await promptModal({
    title: title || t("baseExplorer.rename.title"),
    text: "",
    okText: t("baseExplorer.common.save"),
    cancelText: t("common.cancel"),
    value: String(value || ""),
    maxLength: Number(maxLen) || 80,
    selectAll: true,
  });
  return String(v ?? "").trim() || null;
}
