import { isObject, isString } from "../../src/shared/utils/typeChecks.js";

const SPARK_DESCRIPTOR_FIELDS = [
  "limit_name", "limitName", "metered_feature", "meteredFeature",
  "limit_id", "limitId", "id", "name", "title", "model", "model_id", "modelId",
];

/**
 * Resolves GPT-5.3-Codex-Spark quota across every known `wham/usage` response shape.
 * Direct fields take precedence over indexed and additional limits, matching the
 * provider's normal/review limit selection without coupling either quota parser.
 */
export function resolveCodexSparkRateLimit(data) {
  if (!data || !isObject(data) || Array.isArray(data)) return null;

  const direct = data.spark_rate_limit ??
    data.sparkRateLimit ??
    data.gpt_5_3_codex_spark_rate_limit ??
    data.gpt53CodexSparkRateLimit;
  if (direct !== null && direct !== undefined) return direct;

  const byId = data.rate_limits_by_limit_id ?? data.rateLimitsByLimitId;
  if (byId && isObject(byId) && !Array.isArray(byId)) {
    const indexed = byId["gpt-5.3-codex-spark"] ??
      byId.gpt_5_3_codex_spark ??
      byId["codex-spark"] ??
      byId.codex_spark ??
      byId.spark;
    if (indexed !== null && indexed !== undefined) return indexed;
  }

  const additional = data.additional_rate_limits ?? data.additionalRateLimits;
  if (!Array.isArray(additional)) return null;
  return additional.find((entry) => {
    if (!entry || !isObject(entry) || Array.isArray(entry)) return false;
    const descriptor = SPARK_DESCRIPTOR_FIELDS
      .map((field) => entry[field])
      .filter((value) => isString(value))
      .join(" ")
      .toLowerCase();
    return descriptor.includes("spark");
  }) || null;
}
