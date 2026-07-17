export default {
  id: "zed",
  priority: 902,
  alias: "zd",
  uiAlias: "zd",
  display: {
    name: "Zed IDE",
    icon: "code",
    color: "#084CCF",
    textIcon: "ZD",
    website: "https://zed.dev",
    notice: {
      text: "Zed keychain import metadata only. Imported credentials are stored under their real upstream providers.",
    },
  },
  category: "oauth",
  authType: "oauth",
  authHint: "Use the Zed import flow to discover provider credentials stored by Zed in the OS keychain.",
  hasOAuth: true,
  transport: null,
  models: [],
  hidden: true,
};
