import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isHosted } = require("../../lib/updater/deploymentMode.cjs");

/** Hosted deployments never treat a reverse proxy as a local operator. */
export { isHosted };
