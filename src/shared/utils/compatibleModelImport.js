/** Import each distinct new model and count failed saves without stopping the batch. */
export async function importCompatibleModels(models, existingModels, addModel) {
  const existingIds = new Set(existingModels.map((model) => model.id));
  let imported = 0;
  let failed = 0;
  let skipped = 0;
  for (const model of models) {
    const modelId = model.id || model.name || model.model;
    if (!modelId || existingIds.has(modelId)) {
      skipped += 1;
      continue;
    }
    existingIds.add(modelId);
    try {
      if (await addModel(modelId) === false) failed += 1;
      else imported += 1;
    } catch {
      failed += 1;
    }
  }
  return { imported, failed, skipped };
}
