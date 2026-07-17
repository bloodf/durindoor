export default {
  id: "veoaifree-web",
  priority: 245,
  alias: "veo-free",
  uiAlias: "veo-free",
  display: {
    name: "Veo AI Free Web",
    icon: "movie",
    color: "#DC2626",
    textIcon: "VEO",
    website: "https://veoaifree.com",
  },
  category: "free",
  noAuth: true,
  serviceKinds: ["video"],
  transport: {
    baseUrl: "https://veoaifree.com/wp-admin/admin-ajax.php",
    format: "openai",
    executor: "veoaifree-web",
    authType: "none",
    noAuth: true,
  },
  videoConfig: { baseUrl: "https://veoaifree.com/wp-admin/admin-ajax.php" },
  models: [
    { id: "veo", name: "VEO 3.1", kind: "video" },
    { id: "seedance", name: "Seedance", kind: "video" },
  ],
};
