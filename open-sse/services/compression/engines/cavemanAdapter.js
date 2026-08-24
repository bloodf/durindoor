// open-sse/services/compression/engines/cavemanAdapter.js
//
// F-1a scope: ONLY the caveman engine. lite / aggressive / ultra engines and
// their config schemas are intentionally omitted (those engines are unavailable
// in F-1a and MUST NOT be imported at module load). The `apply` below is a
// faithful port of the caveman branch of omniroute's cavemanAdapter.ts
// (config merge + default-enabled logic for issue #6425), routed through the
// shared bodyAdapter so OpenAI Responses / Kiro envelopes compress and restore.

import { cavemanCompress } from "../caveman.js";
import { adaptBodyForCompression } from "../bodyAdapter.js";
import { isBoolean, isNumber } from "@/shared/utils/typeChecks.js";

const CAVEMAN_INTENSITIES = ["lite", "full", "ultra"];

const CAVEMAN_SCHEMA = [
{
  key: "intensity",
  type: "select",
  label: "Intensity",
  defaultValue: "full",
  options: CAVEMAN_INTENSITIES.map((value) => ({ value, label: value }))
},
{
  key: "minMessageLength",
  type: "number",
  label: "Minimum message length",
  defaultValue: 50,
  min: 0,
  max: 10000
},
{
  key: "enabled",
  type: "boolean",
  label: "Enabled",
  defaultValue: true
}];


function validateCavemanLikeConfig(config) {
  const errors = [];
  if (config.intensity !== undefined && !CAVEMAN_INTENSITIES.includes(config.intensity)) {
    errors.push("intensity must be lite, full, or ultra");
  }
  if (
  config.minMessageLength !== undefined && (
  !isNumber(config.minMessageLength) || config.minMessageLength < 0))
  {
    errors.push("minMessageLength must be a non-negative number");
  }
  if (config.enabled !== undefined && !isBoolean(config.enabled)) {
    errors.push("enabled must be a boolean");
  }
  return { valid: errors.length === 0, errors };
}

export const cavemanEngine = {
  id: "caveman",
  name: "Caveman",
  description: "Rule-based message compression with preservation and validation.",
  icon: "compress",
  targets: ["messages"],
  stackable: true,
  stackPriority: 20,
  metadata: {
    id: "caveman",
    name: "Caveman",
    description: "Rule-based message compression with preservation and validation.",
    inputScope: "messages",
    targetLatencyMs: 1,
    supportsPreview: true,
    stable: true
  },
  apply(body, options) {
    const adapter = adaptBodyForCompression(body);
    // Mirror rtkAdapter's default-enabled behavior. When invoked as a stacked step
    // without explicit `enabled` on either cavemanConfig or stepConfig, default
    // `enabled: true` so the rules actually run. Without this,
    // DEFAULT_CAVEMAN_CONFIG.enabled=false made cavemanCompress() a silent no-op.
    // (Issue #6425.)
    const explicitCavemanConfig = options?.config?.cavemanConfig;
    const explicitStepConfig = options?.stepConfig;
    const explicitEnabled =
    explicitCavemanConfig && "enabled" in explicitCavemanConfig ||
    explicitStepConfig && "enabled" in explicitStepConfig;
    const enabledDefault = explicitEnabled ? {} : { enabled: true };
    const cavemanConfig = {
      ...enabledDefault,
      ...(explicitCavemanConfig ?? {}),
      ...(explicitStepConfig ?? {}),
      ...(options?.config?.languageConfig?.enabled ?
      {
        language: options.config.languageConfig.defaultLanguage,
        autoDetectLanguage: options.config.languageConfig.autoDetect,
        enabledLanguagePacks: options.config.languageConfig.enabledPacks
      } : null),

      ...(options?.config?.preserveSystemPrompt !== false ?
      {
        compressRoles: (options?.config?.cavemanConfig?.compressRoles ?? ["user"]).filter(
          (role) => role !== "system"
        )
      } : null)

    };
    const result = cavemanCompress(adapter.body, cavemanConfig);
    return adapter.adapted ? { ...result, body: adapter.restore(result.body) } : result;
  },
  compress(body, config) {
    return this.apply(body, { stepConfig: config });
  },
  getConfigSchema() {
    return CAVEMAN_SCHEMA;
  },
  validateConfig(config) {
    return validateCavemanLikeConfig(config);
  }
};