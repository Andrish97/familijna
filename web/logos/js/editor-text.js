// familiada/logos/js/editor-text.js
// Strona /logos/editor/text/?id=<logo> -- edytor trybu TEXT (editor-page.js).

import { bootEditorPage } from "./editor-page.js";
import { initTextEditor } from "./text.js";


bootEditorPage({ mode: "TEXT", initEditor: initTextEditor });
