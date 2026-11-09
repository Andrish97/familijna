// familiada/logos/js/editor-text.js
// Strona /logos/editor/text/?id=<logo> -- edytor trybu TEXT (editor-page.js).

import { bootEditorPage } from "./editor-page.js?v=v2026-11-09T13091";
import { initTextEditor } from "./text.js?v=v2026-11-09T13091";


bootEditorPage({ mode: "TEXT", initEditor: initTextEditor });
