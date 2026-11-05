// js/pages/games-import-export.js
import { gameExportSnapshot } from "../../shared/js/core/game-transfer-format.js?v=v2026-11-05T23575";
import { sb } from "../../shared/js/core/supabase.js?v=v2026-11-05T23575";
import { t } from "../../shared/translation/translation.js?v=v2026-11-05T23575";


/* =========================================================
	 Helpers (bezpieczne skracanie / typy)
========================================================= */
const safeQText = (s, i) =>
	(String(s ?? t("gamesImportExport.defaults.question", { ord: i + 1 })).trim() ||
		t("gamesImportExport.defaults.question", { ord: i + 1 })).slice(0, 100);

// The modal keeps its parsed object after a failed request. Its retry must
// acknowledge a committed import even if the first response never arrived.
const importAttempts = new WeakMap();
function importRequestId(payload, ownerId) {
	let owners = importAttempts.get(payload);
	if (!owners) { owners = new Map(); importAttempts.set(payload, owners); }
	if (!owners.has(ownerId)) owners.set(ownerId, crypto.randomUUID());
	return owners.get(ownerId);
}

/* =========================================================
	 EXPORT GAME
========================================================= */

export async function exportGame(gameId, onProgress) {
	const { data: game, error: gErr } = await sb()
		.from("games")
		.select("id,name,type,status")
		.eq("id", gameId)
		.single();
	if (gErr) throw gErr;

	const { data: questions, error: qErr } = await sb()
		.from("questions")
		.select("id,ord,text,answers(ord,text,fixed_points)")
		.eq("game_id", gameId)
		.order("ord", { ascending: true });
	if (qErr) throw qErr;

	const qs = questions || [];
	const out = gameExportSnapshot(game, qs, t("gamesImportExport.defaults.gameName"));
	if (typeof onProgress === "function") {
		onProgress({ step: t("gamesImportExport.export.step"), i: 0, n: qs.length, msg: "" });
		for (let idx = 0; idx < qs.length; idx++) {
			onProgress({ step: t("gamesImportExport.export.step"), i: idx + 1, n: qs.length,
				msg: qs[idx]?.text ? String(qs[idx].text).slice(0, 60) : "" });
		}
	}

	return out;
}

/* =========================================================
	 IMPORT GAME (definicja gry: games + questions + answers)
========================================================= */

export async function importGame(payload, ownerId, onProgress) {
	if (!payload?.game || !Array.isArray(payload.questions)) {
		throw new Error(t("gamesImportExport.import.invalidFormat"));
	}

	const qs = payload.questions;
	const n = qs.length;
	if (typeof onProgress === "function") {
		onProgress({ step: t("gamesImportExport.import.step"), i: 0, n, msg: "" });
	}
	const { data, error } = await sb().rpc("game_import_package", {
		p_payload: payload, p_owner_id: ownerId, p_request_id: importRequestId(payload, ownerId),
		p_defaults: { game: t("gamesImportExport.defaults.gameName"),
			question: t("gamesImportExport.defaults.question", { ord: "{ord}" }),
			answer: t("gamesImportExport.defaults.answer", { ord: "{ord}" }) },
	});
	if (error) throw error;
	if (!data?.ok || !data.id) {
		const key = { invalid_payload: "invalidFormat", auth_required: "authRequired", locked: "locked",
			request_conflict: "requestConflict", previously_removed: "previouslyRemoved" }[data?.error] || "failed";
		throw new Error(t(`gamesImportExport.import.${key}`));
	}
	for (let qi = 0; qi < qs.length; qi++) {
		const qText = safeQText(qs[qi]?.text, qi);
		if (typeof onProgress === "function") {
			onProgress({
				step: t("gamesImportExport.import.step"),
				i: qi + 1,
				n,
				msg: qText ? String(qText).slice(0, 60) : "",
			});
		}
	}
	return data.id;
}

/* =========================================================
	 DOWNLOAD JSON
========================================================= */

export function downloadJson(filename, obj) {
	// Keep the custom .famgame extension from Android adding ".json" by MIME.
	const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/octet-stream" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	// natychmiastowy revoke potrafi w Firefox/Safari przerwać pobieranie
	setTimeout(() => URL.revokeObjectURL(url), 1000);
}
