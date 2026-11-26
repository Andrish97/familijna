// Schemat JSON narzędzia → podzbiór OpenAPI, który przyjmuje Gemini.
// Wspólne dla przeglądarki (providers.js) i serwera (funkcja Edge ai-chat).

export function geminiSchema(s) {
  if (!s || typeof s !== "object") return s;
  if (Array.isArray(s)) return s.map(geminiSchema);
  const out = {};
  for (const [k, v] of Object.entries(s)) {
    if (["type", "description", "enum", "required", "nullable", "format"].includes(k)) out[k] = v;
    else if (k === "properties") out.properties = Object.fromEntries(Object.entries(v || {}).map(([n, x]) => [n, geminiSchema(x)]));
    else if (k === "items") out.items = geminiSchema(v);
  }
  if (Array.isArray(out.type)) out.type = out.type.find((x) => x !== "null") || "string";
  if (out.format && !["enum", "date-time"].includes(out.format)) delete out.format;
  if (out.type === "object" && !out.properties) out.properties = {};
  // Gemini przyjmuje „enum” tylko przy tekście — lista liczb idzie do opisu.
  if (out.enum && (out.type !== "string" || out.enum.some((x) => typeof x !== "string"))) {
    out.description = `${out.description ? `${out.description} ` : ""}(${out.enum.join(" | ")})`;
    delete out.enum;
  }
  return out;
}

