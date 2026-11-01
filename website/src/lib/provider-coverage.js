/** Derive public counts from the same visible entries the provider UI uses.
 * Missing serviceKinds means llm, matching src/shared/constants/providers.js.
 * Called on the server so registry transports do not enter the marketing bundle.
 */
export function providerCoverage(registry, kinds) {
  const visible = registry.filter((provider) => !provider.hidden);
  return {
    total: visible.length,
    kinds: kinds.map((kind) => ({
      ...kind,
      count: visible.filter((provider) => (provider.serviceKinds ?? provider.media?.serviceKinds ?? ["llm"]).includes(kind.registryKind)).length,
    })),
  };
}
