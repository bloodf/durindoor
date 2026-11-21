import { mountPopup } from "./popup.js";

mountPopup(document, { chrome, fetch: (...args) => globalThis.fetch(...args) });
