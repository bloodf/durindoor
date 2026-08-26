export function buildProviderActivity(activeRequests = []) {
  const providers = new Map();
  for (const request of activeRequests) {
    const provider = request.provider?.toLowerCase();
    if (!provider || !request.model) continue;
    if (!providers.has(provider)) providers.set(provider, new Map());
    const models = providers.get(provider);
    if (!models.has(request.model)) models.set(request.model, { count: 0, keys: new Map() });
    const model = models.get(request.model);
    model.count += request.count || 0;
    for (const key of request.keys || []) {
      model.keys.set(key.name, (model.keys.get(key.name) || 0) + (key.count || 0));
    }
  }

  return Object.fromEntries([...providers].map(([provider, models]) => [
    provider,
    [...models]
      .map(([model, activity]) => ({
        model,
        count: activity.count,
        keys: [...activity.keys]
          .map(([name, count]) => ({ name, count }))
          .sort((left, right) => left.name.localeCompare(right.name)),
      }))
      .sort((left, right) => left.model.localeCompare(right.model)),
  ]));
}
