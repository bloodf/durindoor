// Tools domain: MCP gateway, CLI tool settings, MITM, and token savers.
import registerMcpGateway from "./tools/mcpGateway.js";
import registerCliTools from "./tools/cliTools.js";
import registerMitm from "./tools/mitm.js";
import registerSavers from "./tools/savers.js";

export default function register(router, context) {
  registerMcpGateway(router, context);
  registerCliTools(router, context);
  registerMitm(router, context);
  registerSavers(router, context);
}
