import { createTransitionTiming } from "../../shared/js/gameplay/transitionTiming.js?v=v2026-11-08T15284";


export function createActionGate({ getSfxDuration }) {
  const timing = createTransitionTiming({ getSfxDuration });
  const special = {
    SHOW_INTRO: () => timing.syncedMs("show_intro", "reveal"),
    START_ROUND: () => timing.syncedMs("round_transition", "reveal"),
    END_ROUND: () => timing.syncedMs("round_transition", "reveal"),
    NEXT_QUESTION: (_, next) => next?.step === "f_end" ? timing.syncedMs("final_theme", "reveal") : next?.step === "f_p2_start" ? timing.syncedMs("round_transition", "reveal") : 0,
    START_P2_ROUND: () => timing.syncedMs("round_transition", "reveal"),
    START_FINAL: async () => (await timing.dur("final_theme")) + (await timing.syncedMs("round_transition", "reveal")),
    FINISH_FINAL: () => timing.dur("show_outro"),
    GAME_END_SHOW: () => timing.dur("show_outro"),
  };
  async function computeGateMs(action, previous, next) {
    if (!next) return 0;
    if (special[action]) return special[action](previous, next);
    if (previous && next.sound_cue_seq === previous.sound_cue_seq) return 0;
    return timing.dur(next.sound_cue_key);
  }
  return { computeGateMs, timing };
}
