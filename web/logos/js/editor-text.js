// familiada/logos/js/editor-text.js
// Strona /logos/editor/text/?id=<logo> -- edytor trybu TEXT (editor-page.js).

import { bootEditorPage } from "./editor-page.js?v=v2026-11-07T20215";
import { initTextEditor } from "./text.js?v=v2026-11-07T20215";


bootEditorPage({ mode: "TEXT", initEditor: initTextEditor });
