// Price-tier filter for importing models from a compatible provider's /models
// catalog (adapted from decolua/9router#4874). Missing pricing never implies paid.
import { isNumber, isObject, isString } from "./typeChecks.js";

function parsePrice(value) {
  if (!isNumber(value) && (!isString(value) || !value.trim())) return null;
  const price = Number(value);
  return Number.isFinite(price) && price >= 0 ? price : null;
}

function modelPriceTier(model) {
  const pricing = model?.pricing;
  const hasPaidPrice = pricing && isObject(pricing) && !Array.isArray(pricing)
    && Object.values(pricing).some((value) => parsePrice(value) > 0);
  if (model?.tier === "paid" || hasPaidPrice) return "paid";
  const prompt = parsePrice(pricing?.prompt);
  const completion = parsePrice(pricing?.completion);
  if (prompt === 0 && completion === 0) return "free";
  if (model?.tier === "free" || model?.free === true || model?.is_free === true) return "free";
  const id = model?.id || model?.name || model?.model;
  if (isString(id) && (id.endsWith(":free") || id.endsWith("-free"))) return "free";
  return "unknown";
}

export function filterModelsForImport(models, filter = "all") {
  if (!Array.isArray(models)) return [];
  if (filter !== "free" && filter !== "paid") return models;
  return models.filter((model) => modelPriceTier(model) === filter);
}
