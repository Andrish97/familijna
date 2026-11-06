import { deriveEvents } from "./deriveEvents.js?v=v2026-11-06T00320";

import { createTransitionTiming } from "./transitionTiming.js?v=v2026-11-06T00320";


export function createSoundCueEngine({ playSfx, getSfxDuration, stopSfx = () => {}, waitForStart = null }) {
  const timing = createTransitionTiming({ getSfxDuration });
  let generation = 0;
  const timers = new Set();
  const playing = new Set();
  function cancel() {
    generation++;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    for (const key of playing) stopSfx(key);
    playing.clear();
  }
  function play(key, token) {
    if (token !== generation) return;
    playing.add(key);
    playSfx(key);
  }
  function later(callback, ms, token) {
    const timer = setTimeout(() => { timers.delete(timer); if (token === generation) callback(); }, Math.max(0, ms));
    timers.add(timer);
  }
  const duration = timing.dur;
  async function synced(a, b, token, offset = 0) {
    const [da, db] = await Promise.all([duration(a), duration(b)]);
    if (token !== generation) return;
    const total = Math.max(da, db);
    const start = (key, ms) => ms > 0 ? later(() => play(key, token), ms, token) : play(key, token);
    start(a, offset + total - da);
    start(b, offset + total - db);
  }
  async function startFinal(token) {
    play("final_theme", token);
    const lead = await duration("final_theme");
    if (token === generation) await synced("round_transition", "reveal", token, lead);
  }
  async function handleTransition(previous, next) {
    if (!previous || !next) return;
    if (next.top_card === "devices" || next.step === "devices_display" || next.step === "setup_finish") { cancel(); return; }
    const token = generation;
    const events = deriveEvents(previous, next);
    if (waitForStart && events.some((event) => event.kind === "SOUND_CUE" && event.key)) {
      await waitForStart(next.sound_cue_seq);
      if (token !== generation) return;
    }
    const pressed = next.detail?.rounds?.duel?.lastPressed;
    if (next.step === "r_duel" && pressed && !previous.detail?.rounds?.duel?.lastPressed && !next.detail?.settings?.physicalBuzzer) play("buzzer_press", token);
    for (const event of events) {
      if (event.kind !== "SOUND_CUE" || !event.key) continue;
      if (event.key === "buzzer_press" && !next.detail?.settings?.physicalBuzzer) continue;
      if (event.key === "round_transition") synced("round_transition", "reveal", token);
      else if (event.key === "show_intro") synced("show_intro", "reveal", token);
      else if (event.key === "final_theme" && previous.step === "f_start" && next.step === "f_p1_entry") startFinal(token);
      else if (event.key === "final_theme" && next.step === "f_end") synced("final_theme", "reveal", token);
      else if (event.key === "final_end") play("show_outro", token);
      else play(event.key, token);
    }
  }
  return { handleTransition, cancel };
}
