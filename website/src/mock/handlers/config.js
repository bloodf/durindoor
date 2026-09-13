// Config domain: settings, combos, API keys, aliases, proxy pools, database,
// data retention, auto-configure and tunnels.
import registerSettings from "./config/settings.js";
import registerCombos from "./config/combos.js";
import registerKeys from "./config/keys.js";
import registerProxyPools from "./config/proxyPools.js";
import registerDatabase from "./config/database.js";
import registerTunnel from "./config/tunnel.js";

export default function register(router, context) {
  [registerSettings, registerCombos, registerKeys, registerProxyPools, registerDatabase, registerTunnel]
    .forEach((registerPart) => registerPart(router, context));
}
