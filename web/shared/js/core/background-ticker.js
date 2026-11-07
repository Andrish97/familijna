// Interwał, który nie zwalnia w karcie w tle (patrz ticker-worker.js).
// Gdy Worker jest niedostępny, zwykły setInterval.
export function startTicker(callback, intervalMs) {
  try {
    const worker = new Worker(new URL("./ticker-worker.js?v=v2026-11-07T22145", import.meta.url));
    worker.onmessage = () => callback();
    worker.postMessage({ intervalMs });
    return () => worker.terminate();
  } catch {
    const timer = setInterval(callback, intervalMs);
    return () => clearInterval(timer);
  }
}
