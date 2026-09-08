/**
 * Returns connection-declared LLMs when a dynamic compatible provider lacks catalog models.
 */
export function fallbackConnectionModels(connection) {
  const models = [];
  if (connection.defaultModel) models.push({ id: connection.defaultModel, name: connection.defaultModel });
  for (const model of connection.providerSpecificData?.customModels || []) {
    if (model?.id && !models.some((candidate) => candidate.id === model.id)) {
      models.push({ id: model.id, name: model.name || model.id });
    }
  }
  if (models.length === 0 && connection.testStatus === "active") {
    models.push({ id: "model-id", name: "model-id" });
  }
  return models;
}
