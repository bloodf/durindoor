/**
 * Laya — self-hosted "System One" decision engine.
 *
 * Not a chat model: Laya answers typed questions (choice / score / yes-no) over
 * a text in one forward pass. `laya-serve` speaks TypeSafe Jev's
 * `POST /v1/systemone` protocol, so DurinDoor uses an active Laya connection in
 * place of Jev for the smart/task combo complexity classifier (see
 * src/sse/services/decisionBackend.js).
 *
 * - **User-supplied host.** The server is user-run, so its origin lives per
 *   connection in `providerSpecificData.baseUrl` (resolved by resolveLayaHost).
 * - **Optional key.** `laya-serve` only checks a bearer token when started with
 *   `LAYA_API_KEY`; the host stands in for the key (`apiKeyOptionalWith`).
 * - **No transport / "decision" kind only**, so it never shows up as a chat,
 *   media, or combo-member model.
 */
export default {
  id: "laya",
  priority: 60,
  alias: "laya",
  display: {
    name: "Laya (local)",
    icon: "rule",
    color: "#2ea44f",
    textIcon: "LY",
    website: "https://github.com/NandhaKishorM/laya",
    notice: {
      text: "Run `pip install \"laya[serve]\"` then `laya-serve` (default http://127.0.0.1:8000). Set the API key only if the server was started with LAYA_API_KEY. An active Laya connection replaces Jev for smart/task combo routing.",
    },
  },
  category: "apikey",
  apiKeyOptionalWith: "baseUrl",
  models: [
    { id: "auto", name: "Laya router (picks the checkpoint)", kind: "decision" },
    { id: "english", name: "Laya English (ModernBERT-large)", kind: "decision" },
    { id: "multilingual", name: "Laya Multilingual (mmBERT-base, 100+ languages)", kind: "decision" },
    { id: "typed-decisions", name: "Laya Typed Decisions", kind: "decision" },
  ],
  serviceKinds: ["decision"],
};
