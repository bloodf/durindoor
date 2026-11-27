// Adobe Firefly consumer web UI (firefly.adobe.com) driven in an ordinary,
// unmodified Playwright Chromium against an operator-owned browser profile.
// STAGED for #2034: nothing in the registry, the image adapter map or the
// video adapter map imports this module, so it is unavailable to users. See
// docs/providers/adobe-firefly-web.md.
//
// Contract: internal/docs/firefly-consumer-browser-contract.md. That page is a
// review of Adobe's public consumer help (sign in, Prompt field, Model, the
// Generate action, Generation history download). Adobe publishes no stable
// selectors, so this provider ships no Adobe selectors: every control is an
// operator-validated role/name/label mapping stored on the connection, and the
// services/fireflyWebUi flow refuses to launch without it.
//
// This is not the Firefly Services API (`adobe-firefly-api`), and it does not
// make `adobe-firefly` or `firefly` known IDs. It accepts no API key, bearer,
// access token or cookie, and it reads or exports no browser storage.

export const ADOBE_FIREFLY_WEB_ID = "adobe-firefly-web";

// The only origin the browser is ever sent to. Neither the connection nor the
// request can change it.
export const ADOBE_FIREFLY_WEB_ORIGIN = "https://firefly.adobe.com";

const ADOBE_FIREFLY_WEB = {
  id: ADOBE_FIREFLY_WEB_ID,
  display: {
    name: "Adobe Firefly (web UI, staged)",
    icon: "image",
    color: "#475569",
    textIcon: "FW",
    website: ADOBE_FIREFLY_WEB_ORIGIN,
    notice: {
      text: "Staged and unavailable. Drives the Firefly website in an ordinary browser with an operator-owned profile and an operator-validated control mapping. No API key, token or cookie is accepted.",
    },
  },
  category: "web",
  authType: "none",
  transport: null,
  // Models come only from the connection's operator-validated modelMap.
  models: [],
  serviceKinds: ["image", "video"],
};

export default ADOBE_FIREFLY_WEB;
