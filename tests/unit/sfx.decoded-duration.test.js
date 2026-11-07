import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioContextStub, fetchStub } from "./helpers/web-audio.js";
import { getSfxDurationAccurate, getSfxDuration, setSfxVariant, loadSfxManifest } from "../../web/shared/js/core/sfx.js";

test("gameplay duration comes from the decoded buffer, decoded once per source", async () => {
  const saved = { AudioContext: globalThis.AudioContext, localStorage: globalThis.localStorage, fetch: globalThis.fetch };
  globalThis.AudioContext = AudioContextStub;
  globalThis.localStorage = { setItem() {}, getItem() { return null; } };
  globalThis.fetch = fetchStub({ "first.mp3": 1.824, "second.mp3": 0.91 });
  try {
    await loadSfxManifest();
    setSfxVariant("answer_correct", "first.mp3");
    assert.equal(await getSfxDurationAccurate("answer_correct"), 1.824);
    assert.equal(await getSfxDuration("answer_correct"), 1.824);
    const context = AudioContextStub.instances.at(-1);
    assert.equal(context.decodes, 1, "jeden plik dekodowany raz");
    setSfxVariant("answer_correct", "second.mp3");
    assert.equal(await getSfxDurationAccurate("answer_correct"), 0.91);
    assert.equal(context.decodes, 2);
    assert.equal(await getSfxDuration("unknown_key"), 0);
  } finally { Object.assign(globalThis, saved); }
});
