// familiada/logos/js/editor-draw.js
// Strona /logos/editor/draw/?id=<logo> -- edytor trybu DRAW (editor-page.js).

import { bootEditorPage } from "./editor-page.js?v=v2026-11-08T23100";
import { initDrawEditor } from "./draw.js?v=v2026-11-08T23100";


bootEditorPage({ mode: "DRAW", initEditor: initDrawEditor });
