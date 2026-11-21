// familiada/logos/js/editor-image.js
// Strona /logos/editor/image/?id=<logo> -- edytor trybu IMAGE (editor-page.js).

import { bootEditorPage } from "./editor-page.js";
import { initImageEditor } from "./image.js";


bootEditorPage({ mode: "IMAGE", initEditor: initImageEditor });
