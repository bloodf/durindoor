/**
 * Microsoft 365 Copilot request profiles: the `tone` that selects a model, and the scenario,
 * licence and agent a tier routes through.
 *
 * Ported from OmniRoute (cheaper-inference/OmniRoute, MIT) `open-sse/executors/m365Protocol/profile.ts`
 * at 5ffa68e835442a12ed1204a2eebf4076c298aecb. The mappings are protocol values documented upstream,
 * not tenant availability claims: a tenant without a model's licence answers with a licence error.
 * OmniRoute's enterprise option sets and message types are not ported; the invocation shape stays
 * DurinDoor's.
 */
import { isString } from "../../src/shared/utils/typeChecks.js";

const included = (tone) => ({ tone, scenario: "OfficeWebIncludedCopilot", licenseType: "Starter" });
const paid = (tone) => ({ tone, scenario: "OfficeWebPaidCopilot", licenseType: "Premium" });

/** Documented model ids. `copilot-m365` itself has no profile: it keeps the tier defaults. */
export const M365_DOCUMENTED_MODELS = Object.freeze({
  // The protocol tone literal is capitalized; lowercase "magic" is the stale shape.
  "m365-copilot": included("Magic"),
  auto: included("Magic"),
  quick: included("Gpt_5_5_Chat"),
  "think-deeper": included("Gpt_5_5_Reasoning"),
  claude: included("Claude_Sonnet"),
  "claude-sonnet": included("Claude_Sonnet"),
  "claude-sonnet-4.5": included("Claude_Sonnet"),
  "claude-sonnet-4.6": included("Claude_Sonnet"),
  "claude-sonnet-5.5": paid("Claude_Sonnet"),
  "claude-sonnet-5": paid("Claude_Sonnet_5"),
  "claude-sonnet-think-deeper": included("Claude_Sonnet_Reasoning"),
  "claude-opus": paid("Claude_Opus"),
  "claude-opus-5": paid("Claude_Opus"),
  "claude-opus-5.5": paid("Claude_Opus"),
  "claude-opus-4.8": included("Claude_Opus"),
  "claude-opus-4.5": included("Claude_Opus"),
  "gpt-5.5": included("Gpt_5_5_Chat"),
  "gpt-5.5-quick": included("Gpt_5_5_Chat"),
  "gpt-5.5-think-deeper": included("Gpt_5_5_Reasoning"),
  "gpt-5.6": included("Gpt_5_6_Chat"),
  "gpt-5.6-quick": included("Gpt_5_6_Chat"),
  "gpt-5.6-think-deeper": included("Gpt_5_6_Reasoning"),
  "gpt-6-think-deeper": paid("Gpt_6_Reasoning"),
  "gpt-6-sol": included("Gpt_6_Sol_Reasoning"),
  "gpt-6.1-sol": included("Gpt_61_Sol_Reasoning"),
  "gpt-5.4": included("Gpt_5_4_Reasoning"),
  "gpt-5.4-think-deeper": included("Gpt_5_4_Reasoning"),
  "gpt-5.4-quick": included("Gpt_5_4_Chat"),
  "gpt-5.3": included("Gpt_5_3_Chat"),
  "gpt-5.3-quick": included("Gpt_5_3_Chat"),
  "gpt-5.3-think-deeper": included("Gpt_5_3_Reasoning"),
  "gpt-5.2": included("Gpt_5_2_Chat"),
  "gpt-5.2-quick": included("Gpt_5_2_Chat"),
  "gpt-5.2-think-deeper": included("Gpt_5_2_Reasoning")
});

/** Legacy OmniRoute variant ids that select a tone only, never a scenario or licence. */
const LEGACY_TONES = Object.freeze({
  "copilot-m365-claude-opus": "Claude_Opus",
  "copilot-m365-gpt-5-6-reasoning": "Gpt_5_6_Reasoning",
  "copilot-m365-gpt-5-5-chat": "Gpt_5_5_Chat"
});

function tierRoute(tier) {
  if (tier === "enterprise") return { scenario: "officeweb", licenseType: "Premium", agent: "work" };
  return {
    scenario: tier === "edu" ? "OfficeWebIncludedCopilot" : "OfficeWebPaidConsumerCopilot",
    licenseType: "Starter",
    agent: "web"
  };
}

/** Strip a provider prefix (`m365/`, `copilot-m365-web/`) so either id form resolves. */
function bareModel(model) {
  const value = isString(model) ? model : "";
  return value.includes("/") ? value.slice(value.lastIndexOf("/") + 1) : value;
}

/**
 * Precedence per field: explicit override > documented model profile > tier default. A legacy id
 * selects only the tone. Unknown ids (including `copilot-m365`) keep the tier defaults and an
 * empty tone, as before. No entitlement is inferred or granted.
 */
export function resolveM365Profile({ model, tier, tone, scenario, licenseType, agent } = {}) {
  const normalizedTier = tier === "work" ? "enterprise" : tier;
  const route = tierRoute(normalizedTier);
  const id = bareModel(model);
  const documented = Object.hasOwn(M365_DOCUMENTED_MODELS, id) ? M365_DOCUMENTED_MODELS[id] : undefined;
  const legacyTone = Object.hasOwn(LEGACY_TONES, id) ? LEGACY_TONES[id] : undefined;
  return {
    tone: tone ?? documented?.tone ?? legacyTone ?? "",
    scenario: scenario ?? documented?.scenario ?? route.scenario,
    licenseType: licenseType ?? documented?.licenseType ?? route.licenseType,
    agent: agent ?? route.agent
  };
}
