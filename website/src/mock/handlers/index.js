// Registers every mock handler domain on the router.
import registerCore from "./core.js";
import registerProviders from "./providers.js";
import registerUsage from "./usage.js";
import registerConfig from "./config.js";
import registerTools from "./tools.js";
import registerPlayground from "./playground.js";

const DOMAINS = [registerCore, registerProviders, registerUsage, registerConfig, registerTools, registerPlayground];

export function registerAll(router, context) {
  DOMAINS.forEach((register) => register(router, context));
}
