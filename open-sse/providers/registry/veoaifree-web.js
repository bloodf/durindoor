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
  // Optional saved WordPress sign-in. Requests stay anonymous without one.
  // WordPress core names the signed-in cookie `wordpress_logged_in_` + COOKIEHASH,
  // and COOKIEHASH is md5 of the site's configured siteurl option, which the
  // public origin does not reveal (scheme, www, moved install). Import and
  // extension capture therefore accept exactly one `wordpress_logged_in_<md5>`
  // cookie, on exactly this origin; no other `wordpress_*` cookie is kept.
  cookieImport: {
    optionalSession: true,
    origin: "https://veoaifree.com",
    cookieNames: [],
    cookiePrefixes: [],
    hashedCookiePrefixes: ["wordpress_logged_in_"],
  },
  models: [
    { id: "veo", name: "VEO 3.1", kind: "video" },
    { id: "seedance", name: "Seedance", kind: "video" },
  ],
};
