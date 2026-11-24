import parser from "../../lib/updater/deploymentMode.cjs";

const { isHosted } = parser;

/** Hosted deployments never treat a reverse proxy as a local operator. */
export { isHosted };
