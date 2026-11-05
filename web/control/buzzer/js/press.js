import { deriveButtonState, isLockedRow, STATE } from "./render.js?v=v2026-11-05T21204";


export function createPressController({ getRow, render, send, applyRow, refetch, onAccepted, onError }) {
  let pending = null;

  function paint(row) {
    const team = pending && row.step === "r_duel" && row.rev <= pending.rev
      ? pending.team : null;
    render(row, team);
  }

  async function press(team) {
    const row = getRow();
    if (pending || !row || row.step !== "r_duel" || deriveButtonState(row) !== STATE.ON || isLockedRow(row)) return;
    pending = { team, rev: row.rev };
    paint(row); // Same order as the original buzzer: light, then network.
    try {
      const { data, error } = await send(team);
      if (error) {
        if (/already_pressed|locked/.test(error.message || "")) await refetch();
        else onError?.(error);
      } else {
        applyRow(data);
        onAccepted?.(data);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      pending = null;
      const latest = getRow();
      if (latest) paint(latest);
    }
  }

  return { press, render: paint };
}
