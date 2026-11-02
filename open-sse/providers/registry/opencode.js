import { extractReasoningText } from "../../translator/concerns/reasoning.js";
import { isObject } from "../../../src/shared/utils/typeChecks.js";

// The free lane's MiMo route streams thinking as `reasoning` +
// `reasoning_details[]`, not reasoning_content (upstream b8331283). Add the
// canonical field (the aliases stay) so OpenAI-shaped clients, thinking
// accumulation and usage see it. Other models already emit reasoning_content,
// so this is a no-op for them.
function liftReasoningAliases(parsed) {
  if (!Array.isArray(parsed?.choices)) return false;
  let changed = false;
  for (const choice of parsed.choices) {
    const delta = choice?.delta;
    if (!delta || !isObject(delta) || delta.reasoning_content) continue;
    const text = extractReasoningText(delta);
    if (text) {
      delta.reasoning_content = text;
      changed = true;
    }
  }
  return changed;
}

export default {
  id: "opencode",
  priority: 40,
  hasFree: true,
  alias: "oc",
  uiAlias: "oc",
  display: {
    name: "OpenCode Free",
    icon: "terminal",
    color: "#E87040",
    textIcon: "OC",
  },
  category: "free",
  noAuth: true,
  autoComboNoAuth: true,
  // Gateway-wide effort enum; model-scoped capability metadata may narrow it.
  thinkingFormat: "opencode",
  transport: {
    baseUrl: "https://opencode.ai",
    headers: {
      "x-opencode-client": "desktop",
    },
    noAuth: true,
    // Upstream #4041-adjacent cluster: Zen 403s (FreeTierError) on
    // non-streaming free-tier requests. Force stream upstream; chatCore
    // aggregates the SSE back to JSON for clients that asked for JSON.
    forceStream: true,
    // Free reasoning models reject multi-turn history whose assistant messages
    // carry no reasoning_content (400 missing_required_parameter), and the
    // response pipeline strips the field before it reaches the client, so the
    // echo can never come from the client. Inject a placeholder (upstream
    // e964e482). The executor skips it on the Claude Messages route.
    reasoningInject: {
      scope: "all",
    },
    // OpenCode Free 400s the Muse Spark contributor models when tool_choice is
    // anything but "auto" (port of decolua/9router aa14ef72; 1.2 added by
    // upstream #4165, which found the same constraint on that model).
    normalizeStreamChunk: liftReasoningAliases,
    quirks: {
      forceAutoToolChoiceModels: [
        "muse-spark-1.2-contributor-free",
        "muse-spark-1.3-contributor-free",
      ],
    },
  },
  models: [
    { id: "x-preview-f-free", name: "Ox Alpha Free", targetFormat: "openai", supportedFormats: ["openai"] },
    { id: "union-alpha", name: "Union Alpha Free", targetFormat: "claude" },
    { id: "jev-1.13-free", name: "Jev 1.13 Free", kind: "systemone" },
  ],
  serviceKinds: ["llm", "systemone"],
  systemoneConfig: {
    baseUrl: "https://opencode.ai/zen/v1/systemone",
    headers: {
      "x-opencode-client": "desktop",
      "User-Agent": "opencode/1.18.31",
    },
  },
  modelsFetcher: { url: "https://opencode.ai/zen/v1/models", type: "opencode-free" },
  passthroughModels: true,
  features: {
    usage: true,
    usageApikey: true,
  },
};
