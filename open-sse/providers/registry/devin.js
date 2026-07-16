/**
 * Devin cloud-agent (Cognition) provider — distinct from `devin-cli` (the ACP
 * stdio LLM provider). Cloud-agent sessions don't expose per-request model
 * selection like devin-cli's ACP models do, so the catalog is a single
 * placeholder model and there is no chat transport; credential validation is
 * handled by the `devin` specialty validator in
 * `src/app/api/providers/providerProbe.js` (OmniRoute #6894 / diegosouzapw#6142,
 * mirroring the `jules` cloud-agent pattern).
 *
 * The placeholder model carries `kind: "agent"` and the provider declares
 * `serviceKinds: ["agent"]`. Both matter: `buildModelsList` defaults a model
 * without `kind` — and a provider whose serviceKinds is missing or empty — to
 * `"llm"`, which would advertise the unroutable placeholder in /v1/models and
 * LLM selectors even though the provider has no chat transport. No endpoint
 * requests the "agent" kind, so the catalog stays direct-lookup only.
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
  serviceKinds: ["agent"],
  models: [{ id: "devin", name: "Devin (Cognition cloud agent)", kind: "agent" }],
};
