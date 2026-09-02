export const SECTION_LINKS = [
  { id: "appearance", label: "Appearance", icon: "palette" },
  { id: "language", label: "Language", icon: "language" },
  { id: "model-catalog", label: "Model catalog", icon: "view_list" },
  { id: "security", label: "Security", icon: "shield_lock" },
  { id: "oidc", label: "OIDC", icon: "badge" },
  { id: "routing", label: "Routing", icon: "route" },
  { id: "network", label: "Network", icon: "lan" },
  { id: "observability", label: "Observability", icon: "monitoring" },
];

export const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: "light_mode" },
  { value: "dark", label: "Dark", icon: "dark_mode" },
  { value: "system", label: "System", icon: "desktop_windows" },
];

export const LANGUAGE_OPTIONS = [
  { value: "en", label: "English", icon: "language" },
  { value: "pt-BR", label: "Português (Brasil)", icon: "language" },
  { value: "zh-CN", label: "简体中文", icon: "language" },
];

export const AUTH_MODE_OPTIONS = [
  {
    value: "password",
    label: "Password only",
    description: "Use the local dashboard password for every sign-in.",
  },
  {
    value: "oidc",
    label: "OIDC only",
    description: "Delegate dashboard sign-in to your identity provider.",
  },
  {
    value: "both",
    label: "Both",
    description: "Allow OIDC while keeping password sign-in as a fallback.",
  },
];

export const RETENTION_OPTIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "14", label: "14 days" },
  { value: "30", label: "30 days" },
];

export const SETTINGS_DEFAULTS = {
  databasePath: "~/.9router/db/data.sqlite",
  theme: "system",
  language: "en",
  authMode: "both",
  issuerUrl: "https://auth.example.com/realms/durindoor",
  clientId: "durindoor-dashboard",
  clientSecret: "••••••••••••••••••••••••",
  scopes: "openid profile email",
  loginButtonLabel: "Continue with SSO",
  redirectUri: "http://localhost:20127/api/auth/oidc/callback",
  visionModel: "openai/gpt-4o",
  firecrawlUrl: "http://firecrawl:3002",
  retention: "7",
};
