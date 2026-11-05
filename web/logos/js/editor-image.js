// familiada/logos/js/editor-image.js
// Strona /logos/editor/image/?id=<logo> -- edytor trybu IMAGE (editor-page.js).

import { bootEditorPage } from "./editor-page.js?v=v2026-11-05T10213";
import { initImageEditor } from "./image.js?v=v2026-11-05T10213";


bootEditorPage({ mode: "IMAGE", initEditor: initImageEditor });
