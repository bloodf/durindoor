// Parse the dashboard's request-only `model(level)` thinking controls without
// confusing opaque/custom model IDs that legitimately contain parentheses.

import { LEVEL_TO_BUDGET } from "./thinking.js";

/**
 * Parse a recognized thinking suffix from a model ID.
 *
 * Unknown parenthesized values are part of the model ID and are returned
 * byte-for-byte in `cleanModel`. The UI's binary `thinking` choice maps to
 * automatic provider-native thinking.
 *
 * @param {unknown} model
 * @returns {{ cleanModel: unknown, override: null | { mode: "none" | "auto" } | { mode: "budget", budget: number } | { mode: "level", level: string } }}
 */
import { isString } from "../../../src/shared/utils/typeChecks.js";
export function parseSuffix(model) {
  if (!isString(model)) return { cleanModel: model, override: null };
  const match = model.match(/^(.*)\(([^()]+)\)\s*$/);
  if (!match) return { cleanModel: model, override: null };

  const candidate = match[1].trim();
  if (!candidate) return { cleanModel: model, override: null };
  const raw = match[2].trim().toLowerCase();
  if (raw === "none" || raw === "off") {
    return { cleanModel: candidate, override: { mode: "none" } };
  }
  if (raw === "auto" || raw === "thinking") {
    return { cleanModel: candidate, override: { mode: "auto" } };
  }
  if (/^\d+$/.test(raw)) {
    const budget = Number(raw);
    if (!Number.isSafeInteger(budget)) return { cleanModel: model, override: null };
    if (budget === 0) return { cleanModel: candidate, override: { mode: "none" } };
    return { cleanModel: candidate, override: { mode: "budget", budget } };
  }
  if (LEVEL_TO_BUDGET[raw] !== undefined) {
    return { cleanModel: candidate, override: { mode: "level", level: raw } };
  }

  return { cleanModel: model, override: null };
}

/** Strip only a recognized request-only thinking suffix. */
export function stripThinkingSuffix(model) {
  const parsed = parseSuffix(model);
  return parsed.override ? parsed.cleanModel : model;
}