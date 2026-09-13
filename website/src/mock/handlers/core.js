// Session, version and locale endpoints used by the dashboard shell and /login.
import { DEMO_VERSION, OPERATOR } from "../fixtures/world.js";
import { reply } from "../http.js";

const SESSION = "session";

function authStatus(authenticated) {
  return {
    requireLogin: true,
    authMode: "password",
    oidcConfigured: false,
    oidcLoginLabel: "Sign in with OIDC",
    hasPassword: true,
    usingDefaultPassword: false,
    displayName: OPERATOR.name,
    loginMethod: "Password",
    authenticated,
    oidcName: null,
    oidcEmail: null,
    oidcLogin: false,
  };
}

export default function registerCore(router, { store }) {
  store.define(SESSION, { authenticated: true });
  store.define("locale", { locale: "en" });

  router.get("/api/auth/status", () => authStatus(store.get(SESSION).authenticated !== false));
  router.post("/api/auth/login", () => {
    store.set(SESSION, { authenticated: true });
    return { success: true };
  });
  router.post("/api/auth/logout", () => {
    store.set(SESSION, { authenticated: false });
    return { success: true };
  });
  router.post("/api/auth/change-password", () => ({ success: true }));
  router.post("/api/auth/reset-password", () => ({ success: true }));
  router.get("/api/auth/oidc/start", () => reply({ error: "OIDC is not configured in the demo" }, { status: 400 }));
  router.post("/api/auth/oidc/test", () => ({ success: true, ok: true, issuer: "https://id.erebor.dev", message: "Discovery document looks valid" }));

  router.get("/api/version", () => ({ currentVersion: DEMO_VERSION, latestVersion: DEMO_VERSION, hasUpdate: false }));
  router.post("/api/version/update", () => ({ success: true, message: "Already on the latest version" }));
  router.post("/api/version/shutdown", () => ({ success: true }));
  router.post("/api/shutdown", () => ({ success: true }));

  router.get("/api/locale", () => store.get("locale"));
  router.post("/api/locale", ({ body }) => store.set("locale", { locale: body?.locale || "en" }));
}
