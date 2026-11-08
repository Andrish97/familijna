// Logo do zrzutów -- bez materiałów DEMO. Każde przechodzi przez prawdziwy
// edytor (TEXT / DRAW / IMAGE), a wynik zapisu trafia do logos.baked.json
// (node scripts/screens/bake-logos.cjs). Pierwsze logo rysunkowe („Gwiazdy
// wieczoru”) otwiera edytor rysunku; reszcie wystarczy poprawny układ kropek.
// Świat rysunku: 1040 × 440, białe na czarnym.
const star = (cx, cy, r) => {
  const points = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    points.push({ x: Math.round(cx + rr * Math.cos(a)), y: Math.round(cy + rr * Math.sin(a)) });
  }
  return { type: "polygon", points, left: cx - r, top: cy - r, fill: "#ffffff", stroke: null };
};
const text = (t, left, top, fontSize, extra = {}) => ({ type: "i-text", text: t, left, top, originX: "center", originY: "center", fontSize, fontWeight: "bold", fontFamily: "Roboto", fill: "#ffffff", textAlign: "center", styles: {}, ...extra });
// Ścieżka SVG ("M x y C … Z") jako tablica komend, jak w JSON Fabric 5.
const pathCmds = (d) => d.trim().split(/(?=[MLCQZz])/).map((part) => {
  const [cmd, ...nums] = part.trim().split(/[\s,]+/);
  return [cmd, ...nums.filter(Boolean).map(Number)];
});
const scene = (objects, bg = "#000000") => ({ mode: "DRAW", bg: bg === "#000000" ? "BLACK" : "WHITE", world: { w: 1040, h: 440 }, fabricData: { version: "5.3.0", background: bg, objects } });

const svg = (body, bg = "#fff") => `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="420" viewBox="0 0 900 420"><rect width="900" height="420" fill="${bg}"/>${body}</svg>`;

module.exports = [
  // ---------- TEXT ----------
  { mode: "TEXT", age: 1, names: { pl: "Wakacje 2026", en: "Summer 2026", uk: "Літо 2026" }, text: { pl: "WAKACJE", en: "SUMMER", uk: "SUMMER" } },
  { mode: "TEXT", age: 4, names: { pl: "Rodzinny turniej", en: "Family tournament", uk: "Сімейний турнір" }, text: { pl: "RODZINA", en: "FAMILY", uk: "FAMILY" } },
  { mode: "TEXT", age: 9, names: { pl: "Firma XYZ", en: "XYZ Company", uk: "Компанія XYZ" }, text: { pl: "XYZ 2026", en: "XYZ 2026", uk: "XYZ 2026" } },
  { mode: "TEXT", age: 20, names: { pl: "Quiz czwartkowy", en: "Thursday quiz", uk: "Четверговий квіз" }, text: { pl: "QUIZ!", en: "QUIZ!", uk: "QUIZ!" } },

  // ---------- DRAW ----------
  {
    mode: "DRAW", age: 2, names: { pl: "Gwiazdy wieczoru", en: "Stars of the night", uk: "Зірки вечора" },
    source: scene([
      // obrys 22 dolicza się do wymiarów: 30 + 958 + 22 = 1010 (margines 30 z każdej strony)
      { type: "rect", left: 30, top: 30, width: 958, height: 358, rx: 40, ry: 40, fill: "", stroke: "#ffffff", strokeWidth: 22 },
      text("FAMILIJNA", 520, 220, 150),
      star(130, 120, 50), star(910, 120, 50), star(130, 320, 50), star(910, 320, 50),
      { type: "rect", left: 250, top: 330, width: 540, height: 18, rx: 9, ry: 9, fill: "#ffffff" },
      { type: "rect", left: 250, top: 92, width: 540, height: 18, rx: 9, ry: 9, fill: "#ffffff" },
    ]),
  },
  {
    mode: "DRAW", age: 6, names: { pl: "Wesele A&T", en: "Wedding A&T", uk: "Весілля А&Т" },
    source: scene([
      { type: "circle", left: 60, top: 100, radius: 110, fill: "", stroke: "#ffffff", strokeWidth: 24 },
      { type: "circle", left: 190, top: 100, radius: 110, fill: "", stroke: "#ffffff", strokeWidth: 24 },
      text("A & T", 730, 200, 190),
    ]),
  },
  {
    mode: "DRAW", age: 11, names: { pl: "Klasa 8B", en: "Class 8B", uk: "Клас 8Б" },
    source: scene([
      { type: "rect", left: 60, top: 60, width: 920, height: 320, fill: "#ffffff" },
      text("8B", 300, 220, 260, { fill: "#000000" }),
      text("TURNIEJ", 700, 170, 90, { fill: "#000000" }),
      text("2026", 700, 280, 90, { fill: "#000000" }),
    ]),
  },

  // ---------- IMAGE ----------
  {
    mode: "IMAGE", age: 3, names: { pl: "Puchar", en: "Trophy", uk: "Кубок" },
    svg: svg(`<g fill="#000"><path d="M330 60h240v90c0 80-50 130-120 140-70-10-120-60-120-140z"/><path d="M330 90h-70c0 70 30 100 80 110l-4-30c-30-8-46-30-48-60h42zM570 90h70c0 70-30 100-80 110l4-30c30-8 46-30 48-60h-42z"/><rect x="425" y="285" width="50" height="50"/><rect x="360" y="335" width="180" height="40" rx="8"/></g><text x="450" y="200" font-family="Arial" font-weight="bold" font-size="90" text-anchor="middle" fill="#fff">1</text>`),
  },
  {
    mode: "IMAGE", age: 14, names: { pl: "Choinka firmowa", en: "Office Christmas tree", uk: "Корпоративна ялинка" },
    svg: svg(`<g fill="#000"><path d="M450 30l70 100h-35l75 100h-40l90 110H290l90-110h-40l75-100h-35z"/><rect x="425" y="340" width="50" height="55"/></g><g fill="#fff"><circle cx="420" cy="200" r="14"/><circle cx="490" cy="260" r="14"/><circle cx="400" cy="300" r="14"/><circle cx="510" cy="320" r="14"/></g><path fill="#000" d="M120 120l14 30 32 4-24 22 6 32-28-16-28 16 6-32-24-22 32-4zM780 120l14 30 32 4-24 22 6 32-28-16-28 16 6-32-24-22 32-4z"/>`),
  },
];
