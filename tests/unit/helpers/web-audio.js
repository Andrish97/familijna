// Atrapa Web Audio dla testów dźwięku: kontekst, wzmocnienie, bufory.
export class AudioContextStub {
  static instances = [];
  currentTime = 0;
  state = "running";
  destination = {};
  decodes = 0;
  sources = [];
  constructor() { AudioContextStub.instances.push(this); }
  createGain() {
    return { gain: { value: 1, cancelScheduledValues() {}, setValueAtTime() {}, linearRampToValueAtTime() {}, setValueCurveAtTime() {} }, connect() {}, disconnect() {} };
  }
  createMediaElementSource() { return { connect() {}, disconnect() {} }; }
  createBufferSource() {
    const source = {
      buffer: null, onended: null, started: false, stopped: false,
      connect() {}, disconnect() {},
      start() { this.started = true; },
      stop() { this.stopped = true; },
      // Naturalny koniec odtwarzania (wywołuje test).
      finish() { this.onended?.(); },
    };
    this.sources.push(source);
    return source;
  }
  async decodeAudioData(bytes) {
    this.decodes++;
    return { duration: bytes.duration ?? 2 };
  }
  async resume() { this.state = "running"; }
}

// fetch zwracający „plik” o zadanej długości; adresy z "missing" → 404.
export function fetchStub(durations = {}) {
  return async (url) => {
    if (String(url).includes("missing")) return { ok: false, status: 404 };
    const name = String(url).split("/").pop().split("?")[0];
    const buffer = new ArrayBuffer(1);
    buffer.duration = durations[name] ?? 2;
    return { ok: true, arrayBuffer: async () => buffer, json: async () => ({ categories: [{ key: "answer_correct", folder: "answer_correct" }] }) };
  };
}
