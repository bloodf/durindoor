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
  // Optional saved WordPress sign-in. Requests stay anonymous without one. The
  // name is WordPress's logged-in cookie for this site: the fixed prefix plus
  // the site hash (md5 of https://veoaifree.com). Import and extension capture
  // accept exactly this name on exactly this origin.
  cookieImport: {
    optionalSession: true,
    origin: "https://veoaifree.com",
    cookieNames: ["wordpress_logged_in_04e805bfa8c7064a04c2e480966a748b"],
    cookiePrefixes: [],
  },
  models: [
    { id: "veo", name: "VEO 3.1", kind: "video" },
    { id: "seedance", name: "Seedance", kind: "video" },
  ],
};
