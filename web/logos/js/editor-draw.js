// familiada/logos/js/editor-draw.js
// Strona /logos/editor/draw/?id=<logo> -- edytor trybu DRAW (editor-page.js).

import { bootEditorPage } from "./editor-page.js";
import { initDrawEditor } from "./draw.js";


bootEditorPage({ mode: "DRAW", initEditor: initDrawEditor });
