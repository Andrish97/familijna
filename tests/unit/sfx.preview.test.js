import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioContextStub, fetchStub } from "./helpers/web-audio.js";
import { isAnySfxPlaying, isSfxPlaying, loadSfxFromCloud, playSfxPreview, stopSfxPreview, onSfxEnd, onAnySfxEnded, getSfxDuration } from "../../web/shared/js/core/sfx.js";

test("previews stop the previous one; natural end notifies listeners, stop does not", async () => {
  const saved = { AudioContext: globalThis.AudioContext, localStorage: globalThis.localStorage, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.AudioContext = AudioContextStub;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.window = {};
  globalThis.fetch = fetchStub();
  try {
    loadSfxFromCloud(new Map([["preview_a", "/preview-a.mp3"], ["preview_b", "/preview-b.mp3"]]));
    await getSfxDuration("preview_a");
    await getSfxDuration("preview_b");
    const context = AudioContextStub.instances.at(-1);
    const ended = [];
    onAnySfxEnded(key => ended.push(key));
    let endA = 0;
    onSfxEnd("preview_a", () => { endA++; });

    playSfxPreview("preview_a");
    assert.equal(isSfxPlaying("preview_a"), true);
    playSfxPreview("preview_b");
    assert.equal(isSfxPlaying("preview_a"), false);
    assert.equal(isSfxPlaying("preview_b"), true);
    assert.equal(endA, 0, "zatrzymanie to nie koniec dźwięku");

    context.sources.at(-1).finish();
    assert.equal(isSfxPlaying("preview_b"), false);
    assert.equal(isAnySfxPlaying(), false);
    assert.deepEqual(ended, ["preview_b"]);

    stopSfxPreview("preview_b");
    assert.equal(isSfxPlaying("preview_b"), false);
  } finally { Object.assign(globalThis, saved); }
});
