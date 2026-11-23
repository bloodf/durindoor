// Some thinking-mode providers (DeepSeek, Kimi, MiniMax, ...) require reasoning_content
// to be echoed back on assistant messages. Clients in OpenAI format don't send it,
// so we inject a non-empty placeholder to satisfy upstream validation.
import deepseekRegistry from "../providers/registry/deepseek.js";
import { PROVIDERS } from "../config/providers.js";
import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const PLACEHOLDER = " ";

// Provider-level rules derive from registry transport.reasoningInject (single source)
const providerRuleFor = (provider) => PROVIDERS[provider]?.reasoningInject;

// M3.1 requires exact native reasoning_content history. Do not fabricate
// placeholders when its provider rule would otherwise inject every assistant turn.
const M3_1_FLASH_MODELS = new Set(["MiniMax-M3.1-Flash", "MiniMax-M3.1-Flash-Preview"]);
const MINIMAX_PROVIDERS = new Set(["minimax", "minimax-cn"]);
const MODEL_RULES = [
{ match: (m) => /^kimi-/i.test(m || ""), scope: "toolCalls" },
{ match: (m) => /deepseek/i.test(m || ""), scope: "all" }];


// Resolve only declared model names and their aliases. A real catalog name always
// takes precedence over a generated thinking suffix.
function resolveDeepSeekSuffix(model) {
  const rows = deepseekRegistry.models;
  const names = rows.flatMap((row) => [row.id, ...(row.aliases || [])]);
  // The two historical Pro aliases intentionally remain suffix aliases.
  if (names.includes(model) && !["deepseek-v4-pro-max", "deepseek-v4-pro-none"].includes(model)) return null;
  for (const effort of deepseekRegistry.thinkingSuffixes) {
    const suffix = `-${effort}`;
    if (!model?.endsWith(suffix)) continue;
    const base = model.slice(0, -suffix.length);
    const row = rows.find((entry) => entry.id === base || entry.aliases?.includes(base));
    if (row) return { model: row.upstreamModelId || row.id, effort };
  }
  return null;
}

function shouldInject(message, scope) {
  if (message?.role !== "assistant") return false;
  const rc = message.reasoning_content;
  if (isString(rc) && rc.length > 0) return false;
  if (Array.isArray(rc) && rc.length > 0) return false;
  // Idempotence (decolua/9router#4881): the `reasoning` alias counts as a carrier too;
  // serde upstreams reject a second field with "duplicate field `reasoning_content`".
  const rg = message.reasoning;
  if (isString(rg) && rg.length > 0) return false;
  if (Array.isArray(rg) && rg.length > 0) return false;
  if (scope === "toolCalls") return Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
  return true;
}

function applyRule(body, rule) {
  if (!rule || !Array.isArray(body?.messages)) return body;
  const messages = body.messages.map((m) =>
  shouldInject(m, rule.scope) ? { ...m, reasoning_content: PLACEHOLDER } : m
  );
  return { ...body, messages };
}

export function applyDeepSeekV4ProAlias({ provider, model, body, transportFormat = null }) {
  const alias = resolveDeepSeekSuffix(model);
  if (provider !== "deepseek" || !alias || !body) return body;

  if (transportFormat === "claude") {
    const nextBody = {
      ...body,
      model: alias.model,
      thinking: {
        ...(body.thinking && isObject(body.thinking) ? body.thinking : null),
        type: alias.effort === "none" ? "disabled" : "enabled"
      }
    };
    delete nextBody.extra_body;
    delete nextBody.reasoning_effort;
    if (alias.effort !== "none") nextBody.output_config = { ...body.output_config, effort: alias.effort };
    else if (nextBody.output_config) {
      nextBody.output_config = { ...nextBody.output_config };
      delete nextBody.output_config.effort;
    }
    return nextBody;
  }

  const nextBody = {
    ...body,
    model: alias.model,
    extra_body: {
      ...(body.extra_body || {}),
      thinking: {
        ...(body.extra_body?.thinking || {}),
        type: alias.effort === "none" ? "disabled" : "enabled"
      }
    }
  };

  if (alias.effort !== "none") {
    nextBody.reasoning_effort = alias.effort;
  } else {
    delete nextBody.reasoning_effort;
  }

  return nextBody;
}

export function injectReasoningContent({ provider, model, body }) {
  const providerRule = providerRuleFor(provider);
  const modelRule = MODEL_RULES.find((r) => r.match(model));
  const rule = MINIMAX_PROVIDERS.has(provider) && M3_1_FLASH_MODELS.has(model) ? null : providerRule || modelRule;
  const nextBody = applyDeepSeekV4ProAlias({ provider, model, body });
  // Disabled DeepSeek thinking does not require synthetic reasoning history.
  if (provider === "deepseek" && (nextBody?.thinking?.type === "disabled" || nextBody?.extra_body?.thinking?.type === "disabled")) return nextBody;
  return applyRule(nextBody, rule);
}