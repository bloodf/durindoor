/** Review-only icon descriptions. Keep functional meanings separate from glyph names. */
export const ICON_SELECTOR = [
  "[data-v5-locale-mark]", ".material-symbols-outlined:not([data-v5-review-glyph])", ".v5-motion-icon", "[data-icon-name]", "img[src*='/providers/']",
  "img[src*='logo']", "img[src*='/favicon.']", "[role='img']",
  "svg:not(.recharts-surface):not([data-chart]):not([aria-label*='chart' i])",
].join(",");

const MEANINGS = {
  account_tree: "Connection groups and routing relationships", add: "Add a new item", plus: "Add a new item",
  alt_route: "Alternative routing paths", api: "API access and endpoints", apps: "Available applications",
  area_chart: "Activity over time", arrow_back: "Go back", arrow_downward: "Move down", arrow_forward: "Continue forward",
  arrow_upward: "Move up", article: "Read documentation", attach_file: "Attach a file", auto_awesome: "Automatic optimization",
  auto_fix_high: "Automatically configure or improve this item", autorenew: "Refresh automatically", badge: "Account identity",
  bar_chart: "Usage statistics", block: "Blocked or disabled", bolt: "Processing speed", cable: "Provider connections",
  cached: "Cached results", calculate: "Calculate estimated values", chat_bubble: "Chat messages", check: "Selected or completed",
  check_circle: "Completed successfully", done: "Completed successfully", checklist: "Review the checklist", chevron_left: "Previous page", chevron_right: "Next page",
  cleaning_services: "Clear stored data", cloud: "Cloud service", cloud_done: "Cloud service connected", cloud_off: "Cloud service unavailable",
  cloud_sync: "Synchronize with the cloud", cloud_upload: "Upload to the cloud", code: "Source code or API example",
  compare_arrows: "Compare routing or translation results", compress: "Compression and token reduction", content_copy: "Copy to the clipboard",
  content_paste: "Paste from the clipboard", cookie: "Browser cookie authentication", dashboard: "Dashboard overview",
  dashboard_customize: "Customize dashboard widgets", data_object: "Context window measured in tokens", data_usage: "Resource usage",
  database: "Stored application data", delete: "Delete this item", delete_sweep: "Delete selected items", deployed_code: "Deployed service",
  description: "Configuration or documentation", detail: "View details", dns: "Provider servers", door_front: "DurinDoor administration",
  download: "Download or export", drag_indicator: "Drag to reorder", edit: "Edit this item", pencil: "Edit this item",
  edit_note: "Edit the configuration", error: "An error needs attention", event: "Select a date or date range", event_busy: "No scheduled activity",
  expand_more: "Expand or choose an option", expand_less: "Collapse these details", extension: "Installed extension or integration", extension_off: "Integration disabled",
  fact_check: "Validation results", file_copy: "Duplicate this item", filter_alt_off: "Clear filters", filter_list: "Filter the results",
  folder_open: "Open a connection group", forum: "Conversation activity", gavel: "Routing policy and restrictions", grid_view: "Grid layout",
  health_and_safety: "Service health and safeguards", help: "Get help", history: "Previous activity", hourglass_top: "Waiting for completion",
  hub: "Gateway and connected services", image: "Generate images", inbox: "No items to display", info: "Additional information",
  input: "Input sent to the provider", key: "API key access", key_off: "API key unavailable", keyboard_arrow_down: "Expand or move down",
  keyboard_arrow_up: "Collapse or move up", label: "Item labels", lan: "Network connections", language: "Choose the interface language",
  layers: "Model combos and their members", link: "Connected link", link_off: "Disconnected link", list_alt: "Detailed item list",
  lock: "Restricted access", lock_open: "Unrestricted access", login: "Sign in", logout: "Sign out", menu: "Open navigation",
  mic: "Accept audio input", monitor_heart: "Service health", monitoring: "Live monitoring", more_horiz: "More actions", movie: "Generate video",
  network_check: "Check network connectivity", open_in_new: "Open in a new tab", output: "Maximum generated output measured in tokens",
  palette: "Appearance and theme", pause: "Pause activity", pause_circle: "Activity paused", payments: "Estimated usage cost",
  pending_actions: "Pending operations", person: "Account profile", picture_as_pdf: "Read PDF documents", play_arrow: "Start or run",
  play_circle: "Start playback or processing", playlist_add: "Add items to the list", power: "Service power state",
  power_settings_new: "Start or stop the service", price_check: "Model pricing", privacy_tip: "Privacy information",
  progress_activity: "Loading or processing", psychology: "Reasoning capability", public: "Public network access", query_stats: "Request analytics",
  receipt_long: "Request logs", refresh: "Refresh the current data", remove: "Remove this item", restart_alt: "Restart or reset",
  restore: "Restore the previous state", rocket_launch: "Deploy or get started", route: "Request routing", rule: "Routing and error rules",
  savings: "Token savings", schedule: "Timing and timeout", science: "Run a test", search: "Search the available items",
  search_off: "No matching search results", security: "Security and access controls", sell: "Pricing labels", send: "Send the request",
  settings: "Configure settings", shield_lock: "Protected access", shield_person: "Account permissions", skip_next: "Skipped processing",
  smart_toy: "AI model", sort: "Change the order", speed: "Latency and throughput", star: "Favorite item", stop: "Stop processing",
  stop_circle: "Processing stopped", storage: "Storage usage", swap_horiz: "Switch between options", swap_vert: "Change routing order",
  sync: "Synchronize provider data", sync_alt: "Two-way synchronization", system_update: "Software update", table_chart: "Tabular data",
  terminal: "Command line tools", timeline: "Request timeline", toggle_off: "Disabled", toggle_on: "Enabled",
  travel_explore: "Search the web", tune: "Adjust filters or configuration", undo: "Undo the last change", upload: "Upload or import",
  upload_file: "Import a file", verified_user: "Verified access", videocam: "Accept video input", view_list: "List layout",
  visibility: "Visible or image-capable", visibility_off: "Hidden", volume_up: "Generate audio", vpn_key: "API keys",
  vpn_lock: "Protected network access", warning: "A warning needs attention", wifi_tethering: "Live connection", workspaces: "Workspaces",
  circle: "Current status", light_mode: "Light theme", dark_mode: "Dark theme", sunny: "Light theme", nightlight: "Dark theme",
  account_circle: "Account profile", auto_fix: "Automatic configuration", build: "Tools and functions", chat: "Chat conversation",
  code_blocks: "Code blocks", conversion_path: "Routing sequence", diamond: "Model capabilities", folder: "Connection group",
  memory: "Context and processing resources", menu_book: "Read the guide", monitor: "Monitoring dashboard", notes: "Configuration notes",
  perm_media: "Media providers", router: "Request router", shield_with_heart: "Service health and protection",
  space_dashboard: "Dashboard layout", token: "Token usage", translate: "Request and response translation",
};

const CAPABILITIES = {
  vision: "Accepts images as input", "pdf reading": "Reads PDF documents", "audio input": "Accepts audio as input",
  "video input": "Accepts video as input", "image output": "Generates images", "audio output": "Generates audio",
  "video output": "Generates video", "web search": "Searches the web", "tool calls": "Calls tools and functions",
  reasoning: "Supports reasoning",
};

const PROVIDER_NAMES = {
  auggie: "Augment Auggie CLI", augment: "Augment Auggie CLI", cc: "Claude Code", claude: "Claude", cx: "OpenAI Codex",
  codex: "OpenAI Codex", openai: "OpenAI", anthropic: "Anthropic", gemini: "Google Gemini", google: "Google Gemini",
  xai: "xAI", grok: "Grok", qwen: "Qwen", kimi: "Kimi", openrouter: "OpenRouter", orcarouter: "OrcaRouter",
  ollama: "Ollama", "ollama-local": "Ollama", combo: "Nested combo", combos: "Nested combos", "unknown provider": "Unknown provider",
};

function clean(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

/** Choose an icon for a text action, while preserving numeric and period selectors. */
export function actionIcon(label) {
  const value = clean(label).replace(/^[+＋]\s*/, "");
  if (!value || /^\d+(?:[.,]\d+)?(?:\s*(?:ms|s|sec|seconds?|m|min|minutes?|h|hours?|d|days?|w|weeks?|mo|months?|y|years?|%))?$/i.test(value)
    || /^(?:today|yesterday|all time|this (?:week|month|year)|last \d+ (?:days|hours)|\d+[hdwmy]|all|none|default|small|medium|large)$/i.test(value)) return null;
  const rules = [
    [/^(?:save|saving|apply|update settings)/i, "save"], [/^(?:close|cancel|discard|dismiss)/i, "close"],
    [/^(?:done|complete|confirm|finish|i(?: have|['’]ve)|verify|mark all as read)/i, "check"], [/^(?:delete|revoke|remove|kill|shutdown)/i, "delete"],
    [/^pause(?:\s|$)/i, "pause"], [/^resume(?:\s|$)/i, "play_arrow"],
    [/^(?:show fewer|collapse)(?:\s|$)/i, "expand_less"], [/^(?:show all|expand)(?:\s|$)|^\d+ chunks$/i, "expand_more"],
    [/^(?:manage|setup)(?:\s|$)/i, "settings"], [/^undo(?:\s|$)/i, "undo"],
    [/^(?:update now|try automatic update)/i, "system_update"],
    [/^(?:prefer manual install|stuck\? switch to manual install)/i, "download"], [/^reopen login window/i, "login"],
    [/^(?:copy|duplicate|clone)/i, "content_copy"], [/^(?:new|add|create)/i, "add"],
    [/^(?:edit|rename|change|manual config)/i, "edit"], [/^(?:refresh|reload|retry|recheck|reconnect|try again|sync)/i, "refresh"],
    [/^(?:reset|restore|revert)/i, "restart_alt"], [/^(?:clear|clean)/i, "cleaning_services"],
    [/^(?:customize|reorder)/i, "dashboard_customize"], [/^(?:import|upload|batch import|load)/i, "upload"],
    [/^(?:export|download)/i, "download"], [/^(?:back|previous|keep)/i, "arrow_back"],
    [/^(?:continue|next|to )/i, "arrow_forward"], [/^(?:sign in|login|log in|authenticate|authorize|choose cluster)/i, "login"],
    [/^(?:logout|log out|sign out)/i, "logout"], [/^(?:test|check|simulate)/i, "science"],
    [/^(?:send)/i, "send"], [/^(?:stop|disable)/i, "stop"], [/^(?:start|run|enable|restart|active all)/i, "play_arrow"],
    [/^(?:connect|assign|link)/i, "link"], [/^(?:deploy|install|get started)/i, "rocket_launch"],
    [/^(?:open|view|preview|detail|explore|browse)/i, "visibility"], [/^(?:select|choose)/i, "checklist"],
    [/^(?:switch)/i, "swap_horiz"], [/^(?:set password|access keys)/i, "vpn_key"],
    [/^(?:saver settings|configure|settings)/i, "settings"], [/^(?:format)/i, "code"],
    [/^(?:more)/i, "more_horiz"], [/^(?:cookie)/i, "cookie"], [/^(?:database)/i, "database"],
    [/^(?:model pricing)/i, "price_check"], [/^(?:explain)/i, "help"],
  ];
  return rules.find(([pattern]) => pattern.test(value))?.[1] || null;
}

function labelFrom(element) {
  const accessible = element?.hasAttribute?.("data-v5-icon-generated-label") ? null : element?.getAttribute?.("aria-label");
  return clean(accessible || element?.getAttribute?.("title") || element?.getAttribute?.("data-v5-icon-title"));
}

function controlLabel(control) {
  const explicit = labelFrom(control);
  if (explicit) return explicit;
  const clone = control?.cloneNode?.(true);
  clone?.querySelectorAll?.(ICON_SELECTOR).forEach((icon) => icon.remove());
  return clean(clone?.textContent);
}

function providerDescription(element) {
  const raw = clean(element.getAttribute("alt") || labelFrom(element));
  let name = PROVIDER_NAMES[raw.toLowerCase()];
  if (!name && raw.length > 1) name = raw.replace(/[-_]/g, " ");
  if (!name) {
    const heading = element.closest("section")?.querySelector("h3");
    name = controlLabel(heading);
    if (!name || name.length < 2) name = "Unknown provider";
  }
  return name.startsWith("Nested combo") ? `${name} groups models under one routing name` : `${name} provider`;
}

/** Explain the nearest meaningful icon without exposing Material ligatures as copy. */
export function explainIcon(element) {
  if (!element?.matches) return null;
  const host = element.closest(".v5-motion-icon") || element;
  if (host.hasAttribute("data-v5-locale-mark")) return host.closest("button")?.getAttribute("aria-label") || "Choose the interface language";
  const glyph = clean(host.dataset?.iconName || (host.matches(".material-symbols-outlined") ? host.textContent : host.querySelector(".material-symbols-outlined")?.textContent));
  if (["close", "cancel", "save", "save_as", "save_alt"].includes(glyph)) return null;
  const actionControl = host.closest("button,a,[role='button']");
  if (!glyph && actionControl && /^(?:close|save)(?:\s|$)/i.test(controlLabel(actionControl))) return null;
  if (["check", "done"].includes(glyph) && host.closest(".v5-model-check,.v5-model-picker-row")) return "Selected model";
  if (element.closest(".recharts-wrapper,.recharts-surface,[data-chart],.v5-dashboard-chart")) return null;
  if (element.closest(".v5-login-scene") && !actionControl) return null;
  const image = host.matches("img,[role='img'],svg");
  if (image) {
    const rect = host.getBoundingClientRect?.();
    const width = rect?.width || Number(host.getAttribute("width")) || 0;
    const height = rect?.height || Number(host.getAttribute("height")) || 0;
    if (width > 64 || height > 64 || /\b(?:chart|graph|qr code|illustration|screenshot)\b/i.test(labelFrom(host))) return null;
  }
  const capability = host.closest(".v5-capability-mark,.v5-capability-limit");
  if (capability) {
    const label = labelFrom(capability);
    return CAPABILITIES[label.toLowerCase()] || label || MEANINGS[glyph] || null;
  }
  const direct = labelFrom(host);
  if (direct && CAPABILITIES[direct.toLowerCase()]) return CAPABILITIES[direct.toLowerCase()];
  const describedParent = host.parentElement?.closest("[role='img'],[title],[data-v5-icon-title]");
  if (describedParent && !describedParent.matches("button,a,[role='button']")) {
    const description = labelFrom(describedParent);
    if (description && description !== glyph) return CAPABILITIES[description.toLowerCase()] || description;
  }
  const providerImage = host.matches("img[src*='/providers/']");
  if (!providerImage && host.matches("img") && host.getAttribute("alt")) return `${clean(host.getAttribute("alt"))} logo`;
  const providerFallback = !glyph && host.matches("[role='img']:not(svg):not(.v5-motion-icon):not(.material-symbols-outlined)") && !host.querySelector(ICON_SELECTOR) && clean(host.textContent).length <= 1;
  if (providerImage || providerFallback) return providerDescription(host);
  if (direct) return direct;
  const control = host.closest("button,a,[role='button'],[role='option'],label");
  if (control) {
    const action = controlLabel(control);
    if (action && action !== glyph) return action;
  }
  const titled = host.closest("[title],[data-v5-icon-title],[aria-label]:not([data-v5-icon-generated-label])");
  const contextual = labelFrom(titled);
  // Landmark names describe a page section, not the meaning of its individual icons.
  const landmark = titled?.matches("main,nav,aside,header,footer,[role='region'],[role='dialog'],[role='navigation'],[role='main'],[role='complementary']");
  if (!landmark && contextual && contextual !== glyph && !/\b(?:dialog|chart|catalog)\b/i.test(contextual)) return CAPABILITIES[contextual.toLowerCase()] || contextual;
  if (host.matches("svg") && host.closest("[draggable='true'],.v5-model-grip,[data-drag-handle]")) return "Drag to reorder";
  const plainGlyph = glyph.replace(/_/g, " ");
  return MEANINGS[glyph] || (plainGlyph ? `${plainGlyph[0].toUpperCase()}${plainGlyph.slice(1)} icon` : "Interface icon");
}
