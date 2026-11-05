// familiada/logos/js/editor-draw.js
// Strona /logos/editor/draw/?id=<logo> -- edytor trybu DRAW (editor-page.js).

import { bootEditorPage } from "./editor-page.js?v=v2026-11-05T23304";
import { initDrawEditor } from "./draw.js?v=v2026-11-05T23304";


bootEditorPage({ mode: "DRAW", initEditor: initDrawEditor });
