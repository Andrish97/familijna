// familiada/logos/js/editor-image.js
// Strona /logos/editor/image/?id=<logo> -- edytor trybu IMAGE (editor-page.js).

import { bootEditorPage } from "./editor-page.js?v=v2026-11-08T21561";
import { initImageEditor } from "./image.js?v=v2026-11-08T21561";


bootEditorPage({ mode: "IMAGE", initEditor: initImageEditor });
