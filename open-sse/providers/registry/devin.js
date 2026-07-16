/**
 * Devin cloud-agent (Cognition) provider — distinct from `devin-cli` (the ACP
 * stdio LLM provider). Cloud-agent sessions don't expose per-request model
 * selection like devin-cli's ACP models do, so the catalog is a single
 * placeholder model and there is no chat transport; credential validation is
 * handled by the `devin` specialty validator in
 * `src/app/api/providers/providerProbe.js` (OmniRoute #6894 / diegosouzapw#6142,
 * mirroring the `jules` cloud-agent pattern).
 */
export default {
  id: "devin",
  priority: 100,
  alias: "devin",
  display: {
    name: "Devin",
    icon: "cloud",
    color: "#111827",
    textIcon: "DV",
    website: "https://devin.ai",
    notice: {
      text: "Credentials and model catalog only — chat requests are not supported on this provider.",
    },
  },
  category: "apikey",
  authType: "apikey",
  authHint: "Cognition service-user API token (docs.devin.ai/api-reference).",
  transport: null,
  models: [{ id: "devin", name: "Devin (Cognition cloud agent)" }],
};
