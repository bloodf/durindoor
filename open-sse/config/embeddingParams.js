// NVIDIA asymmetric embedding models require input_type; query is the safe
// default for retrieval. Clients indexing documents can explicitly send passage.
export const DEFAULT_INPUT_TYPE = "query";
export const INPUT_TYPE_VALUES = ["query", "passage"];

export function resolveInputType(modelParams, value) {
  if (!modelParams?.includes("input_type")) return null;
  const normalized = typeof value === "string" ? value.trim().toLowerCase() : "";
  return INPUT_TYPE_VALUES.includes(normalized) ? normalized : DEFAULT_INPUT_TYPE;
}
