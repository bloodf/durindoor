// Providers domain: connections, compatible nodes, groups, OAuth flows,
// model catalog, quota snapshots, health and pricing.
import { seedConnections, seedProviderNodes, seedConnectionGroups } from "../fixtures/providers/connections.js";
import { seedCustomModels, seedDisabledModels } from "../fixtures/providers/catalog.js";
import { INITIAL_CODEX_RESET_CREDITS } from "../fixtures/providers/quota.js";
import { CONNECTIONS, NODES, GROUPS, CUSTOM_MODELS, DISABLED_MODELS, PRICING, RESET_CREDITS } from "./providers/shared.js";
import registerConnections from "./providers/connections.js";
import registerNodes from "./providers/nodes.js";
import registerModels from "./providers/models.js";
import registerOAuth from "./providers/oauth.js";
import registerQuota from "./providers/quota.js";

export default function register(router, context) {
  const { store } = context;
  store.define(CONNECTIONS, seedConnections);
  store.define(NODES, seedProviderNodes);
  store.define(GROUPS, seedConnectionGroups);
  store.define(CUSTOM_MODELS, seedCustomModels);
  store.define(DISABLED_MODELS, seedDisabledModels);
  store.define(PRICING, () => ({}));
  store.define(RESET_CREDITS, () => ({ ...INITIAL_CODEX_RESET_CREDITS }));

  [registerConnections, registerNodes, registerModels, registerOAuth, registerQuota].forEach((sub) => sub(router, context));
}
