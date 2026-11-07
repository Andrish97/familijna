import { test } from "node:test";
import assert from "node:assert/strict";
import { AudioContextStub, fetchStub } from "./helpers/web-audio.js";
import { loadSfxFromCloud, onSfxPlayback, playSfx, isSfxPlaying, getSfxDuration } from "../../web/shared/js/core/sfx.js";

test("gameplay sounds start from decoded buffers at once and report load or autoplay failures", async () => {
  const saved = { AudioContext: globalThis.AudioContext, localStorage: globalThis.localStorage, window: globalThis.window, fetch: globalThis.fetch };
  globalThis.AudioContext = AudioContextStub;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.window = {};
  globalThis.fetch = fetchStub({ "music.mp3": 4.75, "reveal.mp3": 0.91 });
  const events = [];
  try {
    loadSfxFromCloud(new Map([["music", "/music.mp3"], ["reveal", "/reveal.mp3"], ["broken", "/missing.mp3"]]));
    await getSfxDuration("music");
    await getSfxDuration("reveal");
    const unsubscribe = onSfxPlayback(event => events.push(event));
    const context = AudioContextStub.instances.at(-1);

    // Drugi dźwięk w trakcie pierwszego startuje w tym samym takcie (bez czekania).
    playSfx("music");
    playSfx("reveal");
    assert.equal(context.sources.length, 2);
    assert.ok(context.sources.every(source => source.started));
    assert.equal(isSfxPlaying("music") && isSfxPlaying("reveal"), true);
    assert.deepEqual(events.map(e => [e.key, e.failed]), [["music", false], ["reveal", false]]);

    playSfx("broken");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.at(-1).key, "broken");
    assert.equal(events.at(-1).failed, true);

    // Zawieszony kontekst bez gestu: dźwięk nie gra, zgłoszone jako blokada autoplay.
    context.state = "suspended";
    context.resume = async () => { throw new Error("needs gesture"); };
    playSfx("reveal");
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(events.at(-1).failed, true);
    assert.equal(events.at(-1).error, "NotAllowedError");
    unsubscribe();
  } finally { Object.assign(globalThis, saved); }
});
