import antigravity from "./antigravity.js";

// Antigravity CLI (`agy`) uses the same Google Code Assist backend and OAuth
// client shape as the IDE provider, but keeps a separate provider id/alias so
// imported CLI credentials do not collide with existing Antigravity accounts.
export default {
  ...antigravity,
  id: "agy",
  alias: "agy",
  uiAlias: "agy",
  display: {
    ...antigravity.display,
    name: "Antigravity CLI",
    website: "https://antigravity.google",
  },
  transport: {
    ...antigravity.transport,
    executor: "antigravity",
  },
  passthroughModels: true,
};
