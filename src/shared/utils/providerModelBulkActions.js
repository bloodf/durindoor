// Bulk "test & disable failed models" for the provider detail page (9router #1740).
// Pure async orchestration so the dashboard handler stays thin and testable.
// Only a hard "error" outcome disables a model; "skipped" and "ok" never do.
export async function testAndDisableFailedModels({
  modelIds = [],
  testModel,
  disableModels,
  delayMs = 250,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  onProgress,
}) {
  const failedIds = [];
  for (let index = 0; index < modelIds.length; index += 1) {
    const modelId = modelIds[index];
    onProgress?.(modelId);
    const outcome = await testModel(modelId);
    if (outcome === "error") failedIds.push(modelId);
    if (index < modelIds.length - 1 && delayMs > 0) await sleep(delayMs);
  }
  if (failedIds.length > 0) await disableModels(failedIds);
  return { testedCount: modelIds.length, failedIds };
}

export function bulkDisableMessage(failedCount) {
  return failedCount === 0
    ? "No error models found."
    : `Disabled ${failedCount} error model${failedCount === 1 ? "" : "s"}.`;
}
