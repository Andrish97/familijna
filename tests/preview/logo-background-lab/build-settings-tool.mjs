import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const target = path.resolve(dir, "../../../web/admin/tools/logo-background-lab/index.html");
const samplesDir = path.resolve(dir, "../../../web/admin/tools/logo-background-lab/samples");
const sampleFiles = {
  WHITE: "white.svg",
  SOLID_BLUE: "solid-blue.svg",
  SOLID_GREEN: "solid-green.svg",
  SOLID_VIOLET: "solid-violet.svg",
  CREAM: "cream-shadow.svg",
  PATTERN: "patterned-background.svg",
  DARK: "dark-background.svg",
  WHITE_DETAIL: "white-details.svg",
  ROUGH_EDGES: "rough-edges.svg",
  DEMO_IMAGE: path.resolve(dir, "../../fixtures/demo-image.png"),
};
let html = await fs.readFile(path.join(dir, "index.template.html"), "utf8");
const app = await fs.readFile(path.join(dir, "background-removal.js"), "utf8");
for (const [key, filename] of Object.entries(sampleFiles)) {
  const source = path.isAbsolute(filename) ? filename : path.join(samplesDir, filename);
  const image = await fs.readFile(source);
  const mimeType = filename.endsWith(".png") ? "image/png" : "image/svg+xml";
  html = html.replaceAll(`__SAMPLE_${key}__`, `data:${mimeType};base64,${image.toString("base64")}`);
}
html = html.replace("<script>/* APP_SCRIPT */</script>", `<script>\n${app}\n</script>`);
await fs.writeFile(target, html);
console.log(`Created standalone Settings tool (${Buffer.byteLength(html)} bytes)`);
