// Declarative combo invariants (port of OmniRoute #8304).
import { isObject, isString } from "../../shared/utils/typeChecks.js";
//
// A combo MAY constrain which providers and/or model families its targets are
// allowed to use. When set, every non-combo-ref target is validated on
// create/update; a violating target aborts the write atomically. Constraints
// live under `combo.invariant` (or top-level `allowedProviders` /
// `allowedModelFamilies`) so they round-trip through the stored combo JSON.

export class ComboInvariantError extends Error {}

const FAMILY_PATTERNS = [
["gpt", /^gpt(?:-|$)/i],
["claude", /^claude(?:-|$)/i],
["gemini", /^gemini(?:-|$)/i],
["glm", /^glm(?:-|$)/i],
["kimi", /^kimi(?:-|$)/i],
["llama", /^llama(?:-|$)/i],
["minimax", /^minimax(?:-|$)/i],
["mistral", /^(?:mistral|mixtral)(?:-|$)/i]];


function strings(value) {
  return Array.isArray(value) ? value.filter((item) => isString(item)) : [];
}

function modelFamily(model) {
  const bare = model.slice(model.lastIndexOf("/") + 1);
  const hit = FAMILY_PATTERNS.find(([, pattern]) => pattern.test(bare));
  return hit ? hit[0] : null;
}

/**
 * Throw ComboInvariantError if any target violates the combo's allowed
 * providers / model families. No-op when no constraints are declared.
 * @param {Record<string, unknown>} combo
 */
export function validateComboInvariant(combo) {
  const invariant =
  combo.invariant && isObject(combo.invariant) && !Array.isArray(combo.invariant) ?
  combo.invariant :
  {};
  const providers = new Set([
  ...strings(combo.allowedProviders),
  ...strings(invariant.allowedProviders)]
  );
  const families = new Set([
  ...strings(combo.allowedModelFamilies),
  ...strings(invariant.allowedModelFamilies)]
  );
  if (providers.size === 0 && families.size === 0) return;

  const targets = Array.isArray(combo.models) ? combo.models : [];
  targets.forEach((value, index) => {
    let target;
    if (isString(value)) {
      const separator = value.indexOf("/");
      if (separator < 0) return;
      target = { provider: value.slice(0, separator), model: value.slice(separator + 1) };
    } else {
      if (!value || !isObject(value) || Array.isArray(value)) return;
      target = value;
      if (target.kind === "combo-ref") return;
    }
    const model = isString(target.model) ? target.model : "";
    const provider =
    isString(target.providerId) ?
    target.providerId :
    isString(target.provider) ?
    target.provider :
    model.includes("/") ?
    model.slice(0, model.indexOf("/")) :
    "";
    const family = modelFamily(model);
    if (
    providers.size > 0 && !providers.has(provider) ||
    families.size > 0 && (!family || !families.has(family)))
    {
      throw new ComboInvariantError(
        `Combo "${String(combo.name ?? "unnamed")}" target ${index + 1} (${provider}/${model}) violates its invariant`
      );
    }
  });
}