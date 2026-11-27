const http = require("http");
const https = require("https");
const crypto = require("crypto");
const fs = require("node:fs");
const path = require("node:path");
const { machineIdSync } = require("node-machine-id");
const { getAppDataDir } = require("../appDataDir");

// Default configuration
const DEFAULT_CONFIG = {
  host: "localhost",
  port: 20128,
  protocol: "http:",
};

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const CLI_TOKEN_SALT = "9r-cli-auth";

let config = { ...DEFAULT_CONFIG };
let cachedCliToken = null;
let cachedCliSecret = null;
let cachedAuthFiles = null;

// Resolved on first use: getAppDataDir() creates the directory, and requiring the CLI must not.
function authFiles() {
  if (!cachedAuthFiles) {
    const dataDir = getAppDataDir();
    const authDir = path.join(dataDir, "auth");
    cachedAuthFiles = {
      machineId: path.join(dataDir, "machine-id"),
      authDir,
      cliSecret: path.join(authDir, "cli-secret"),
    };
  }
  return cachedAuthFiles;
}

// Read raw machineId from shared file (written by server) → guarantees token match
function loadRawMachineId() {
  try {
    const raw = fs.readFileSync(authFiles().machineId, "utf8").trim();
    if (raw) return raw;
  } catch {}
  try { return machineIdSync(); } catch { return ""; }
}

// Random secret shared with server via file → token unpredictable from machineId alone.
function loadCliSecret() {
  if (cachedCliSecret) return cachedCliSecret;
  try {
    cachedCliSecret = fs.readFileSync(authFiles().cliSecret, "utf8").trim();
    if (cachedCliSecret) return cachedCliSecret;
  } catch {}
  cachedCliSecret = crypto.randomBytes(32).toString("hex");
  try {
    fs.mkdirSync(authFiles().authDir, { recursive: true });
    fs.writeFileSync(authFiles().cliSecret, cachedCliSecret, { mode: 0o600 });
  } catch {}
  return cachedCliSecret;
}

function getCliToken() {
  if (cachedCliToken !== null) return cachedCliToken;
  const raw = loadRawMachineId();
  const secret = loadCliSecret();
  cachedCliToken = raw ? crypto.createHash("sha256").update(raw + CLI_TOKEN_SALT + secret).digest("hex").substring(0, 16) : "";
  return cachedCliToken;
}

/**
 * Configure API client
 * @param {Object} options - Configuration options
 * @param {string} options.host - API host
 * @param {number} options.port - API port
 * @param {string} options.protocol - Protocol (http: or https:)
 */
function configure(options = {}) {
  config = { ...config, ...options };
}

/**
 * Make HTTP request to API
 * @param {string} method - HTTP method
 * @param {string} path - API path
 * @param {Object} body - Request body (optional)
 * @returns {Promise<Object>} Response with { success, data/error }
 */
function makeRequest(method, path, body = null) {
  return new Promise((resolve) => {
    const httpModule = config.protocol === "https:" ? https : http;
    const onNetworkError = (err) => {
      resolve({
        success: false,
        error: `Network error: ${err.message}`,
      });
    };
    
    const options = {
      hostname: config.host,
      port: config.port,
      path: path,
      method: method,
      headers: {
        "Content-Type": "application/json",
        [CLI_TOKEN_HEADER]: getCliToken(),
      },
    };

    // Add Content-Length for POST/PUT requests
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      const bodyString = JSON.stringify(body);
      options.headers["Content-Length"] = Buffer.byteLength(bodyString);
    }

    const req = httpModule.request(options, (res) => {
      let data = "";

      // A disconnect after the headers fires on the response, and "end" never does.
      res.on("error", onNetworkError);

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          
          // Check if response indicates error
          if (res.statusCode >= 400 || parsed.error) {
            resolve({
              success: false,
              error: parsed.error || `HTTP ${res.statusCode}`,
              ...(path.startsWith("/api/oauth/") && path.endsWith("/poll") && parsed.pending === true ? { pending: true } : {}),
              statusCode: res.statusCode,
            });
          } else {
            resolve({
              success: true,
              data: parsed,
              statusCode: res.statusCode,
            });
          }
        } catch (err) {
          resolve({
            success: false,
            error: `Failed to parse response: ${err.message}`,
          });
        }
      });
    });

    req.on("error", onNetworkError);

    req.on("timeout", () => {
      req.destroy();
      resolve({
        success: false,
        error: "Request timeout",
      });
    });

    // Set timeout (30 seconds)
    req.setTimeout(30000);

    // Write body if present
    if (body && (method === "POST" || method === "PUT" || method === "PATCH")) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// ============================================================================
// PROVIDERS API
// ============================================================================

/**
 * Get all providers
 * @returns {Promise<Object>} { success, data: { connections } }
 */
async function getProviders() {
  return makeRequest("GET", "/api/providers");
}

/**
 * Get provider by ID
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { connection } }
 */
async function getProviderById(id) {
  return makeRequest("GET", `/api/providers/${id}`);
}

/**
 * Test provider connection
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { valid, error } }
 */
async function testProvider(id) {
  return makeRequest("POST", `/api/providers/${id}/test`);
}

/**
 * Delete provider
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { message } }
 */
async function deleteProvider(id) {
  return makeRequest("DELETE", `/api/providers/${id}`);
}

/**
 * Get provider models
 * @param {string} id - Provider ID
 * @returns {Promise<Object>} { success, data: { provider, connectionId, models } }
 */
async function getProviderModels(id) {
  return makeRequest("GET", `/api/providers/${id}/models`);
}

// ============================================================================
// OAUTH API
// ============================================================================

/**
 * Get OAuth authorization URL
 * @param {string} provider - Provider ID
 * @returns {Promise<Object>} Public { authUrl, state, flowId, expiresAt }; private context stays on the server.
 */
async function getOAuthAuthUrl(provider) {
  // Codex requires fixed port 1455 and path /auth/callback
  const redirectUri = provider === "claude"
    ? "https://platform.claude.com/oauth/code/callback"
    : provider === "codex"
    ? "http://localhost:1455/auth/callback"
    : "http://localhost:20128/callback";
  return makeRequest("GET", `/api/oauth/${provider}/authorize?redirect_uri=${encodeURIComponent(redirectUri)}`);
}

/**
 * Exchange OAuth authorization code for token
 * @param {string} provider - Provider ID
 * @param {Object} data - { code, state, flowId }
 * @returns {Promise<Object>} { success, data }
 */
async function exchangeOAuthCode(provider, data) {
  return makeRequest("POST", `/api/oauth/${provider}/exchange`, data);
}

/**
 * Get OAuth device code
 * @param {string} provider - Provider ID
 * @returns {Promise<Object>} Public device instructions, interval, expiresAt and flowId.
 */
async function getOAuthDeviceCode(provider) {
  return makeRequest("GET", `/api/oauth/${provider}/device-code`);
}

/** Cancel the server-owned flow without sending private provider credentials. */
async function cancelOAuthFlow(provider, data) {
  return makeRequest("POST", `/api/oauth/${provider}/cancel`, data);
}

/**
 * Poll OAuth token using the server-owned device flow
 * @param {string} provider - Provider ID
 * @param {Object} data - { flowId }
 * @returns {Promise<Object>} OAuth { success, pending, error }, independent of HTTP success.
 */
async function pollOAuthToken(provider, data) {
  const result = await makeRequest("POST", `/api/oauth/${provider}/poll`, data);
  // makeRequest wraps HTTP success, while OAuth pending is an application
  // result. Preserve that result even when the server returns an error field.
  return result.data ? { ...result.data, statusCode: result.statusCode } : result;
}

/**
 * Create API key provider connection
 * @param {Object} data - { provider, name, apiKey }
 * @returns {Promise<Object>} { success, data }
 */
async function createApiKeyProvider(data) {
  return makeRequest("POST", "/api/providers", data);
}

/**
 * Update provider connection
 * @param {string} id - Connection ID
 * @param {Object} data - { name, priority, defaultModel, isActive }
 * @returns {Promise<Object>} { success, data: { connection } }
 */
async function updateConnection(id, data) {
  return makeRequest("PUT", `/api/providers/${id}`, data);
}

// ============================================================================
// API KEYS API
// ============================================================================

/**
 * Get all API keys
 * @returns {Promise<Object>} { success, data: { keys } }
 */
async function getApiKeys() {
  return makeRequest("GET", "/api/keys");
}

/**
 * Create new API key
 * @param {string} name - Key name
 * @param {string|null} expiresAt - Optional ISO expiry timestamp
 * @returns {Promise<Object>} { success, data: { key, name, id, machineId, expiresAt } }
 */
async function createApiKey(name, expiresAt = null) {
  return makeRequest("POST", "/api/keys", { name, expiresAt });
}

/** Update mutable API-key management fields without retrieving its secret. */
async function updateApiKey(id, data) {
  return makeRequest("PUT", `/api/keys/${id}`, data);
}

/**
 * Delete API key
 * @param {string} id - Key ID
 * @returns {Promise<Object>} { success, data: { success } }
 */
async function deleteApiKey(id) {
  return makeRequest("DELETE", `/api/keys/${id}`);
}

// ============================================================================
// COMBOS API
// ============================================================================

/**
 * Get all combos
 * @returns {Promise<Object>} { success, data: { combos } }
 */
async function getCombos() {
  return makeRequest("GET", "/api/combos");
}

/**
 * Get combo by ID
 * @param {string} id - Combo ID
 * @returns {Promise<Object>} { success, data: combo }
 */
async function getComboById(id) {
  return makeRequest("GET", `/api/combos/${encodeURIComponent(id)}`);
}

/**
 * Create new combo
 * @param {Object} data - Combo data { name, models }
 * @returns {Promise<Object>} { success, data: combo }
 */
async function createCombo(data) {
  return makeRequest("POST", "/api/combos", data);
}

/**
 * Update combo
 * @param {string} id - Combo ID
 * @param {Object} data - Update data { name?, models? }
 * @returns {Promise<Object>} { success, data: combo }
 */
async function updateCombo(id, data) {
  return makeRequest("PUT", `/api/combos/${id}`, data);
}

/**
 * Delete combo
 * @param {string} id - Combo ID
 * @returns {Promise<Object>} { success, data: { success } }
 */
async function deleteCombo(id) {
  return makeRequest("DELETE", `/api/combos/${id}`);
}

// ============================================================================
// CLI TOOLS API
// ============================================================================

/**
 * Get CLI tool settings
 * @param {string} tool - Tool name: claude | codex | droid | openclaw
 * @returns {Promise<Object>} { success, data: { installed, has9Router, ... } }
 */
async function getCliToolSettings(tool) {
  return makeRequest("GET", `/api/cli-tools/${tool}-settings`);
}

/**
 * Apply CLI tool settings (POST)
 * @param {string} tool - Tool name: claude | codex | droid | openclaw
 * @param {Object} body - Payload depends on tool
 * @returns {Promise<Object>} { success, data }
 */
async function applyCliToolSettings(tool, body) {
  return makeRequest("POST", `/api/cli-tools/${tool}-settings`, body);
}

/**
 * Reset CLI tool settings (DELETE)
 * @param {string} tool - Tool name: claude | codex | droid | openclaw
 * @returns {Promise<Object>} { success, data }
 */
async function resetCliToolSettings(tool) {
  return makeRequest("DELETE", `/api/cli-tools/${tool}-settings`);
}

// ============================================================================
// SETTINGS API
// ============================================================================

/**
 * Get settings
 * @returns {Promise<Object>} { success, data: settings }
 */
async function getSettings() {
  return makeRequest("GET", "/api/settings");
}

/**
 * Update settings
 * @param {Object} data - Settings data
 * @returns {Promise<Object>} { success, data: settings }
 */
async function updateSettings(data) {
  return makeRequest("PATCH", "/api/settings", data);
}

async function updateConnectionAutoPing(connectionId, enabled) {
  return makeRequest("PATCH", `/api/providers/${encodeURIComponent(connectionId)}/auto-ping`, { enabled });
}

/**
 * Reset dashboard password to default (clears stored hash server-side)
 * @returns {Promise<Object>} { success }
 */
async function resetPassword() {
  return makeRequest("POST", "/api/auth/reset-password");
}

// ============================================================================
// MODELS API
// ============================================================================

/**
 * Get all models (internal API)
 * @returns {Promise<Object>} { success, data: { models } }
 */
async function getModels() {
  return makeRequest("GET", "/api/models");
}

/**
 * Get available models from active providers + combos (OpenAI compatible)
 * @returns {Promise<Object>} { success, data: { object, data: [...models] } }
 */
async function getAvailableModels() {
  return makeRequest("GET", "/v1/models");
}

// ============================================================================
// PROVIDER NODES API (custom providers)
// ============================================================================

async function getProviderNodes() {
  return makeRequest("GET", "/api/provider-nodes");
}

async function createProviderNode(data) {
  return makeRequest("POST", "/api/provider-nodes", data);
}

async function updateProviderNode(id, data) {
  return makeRequest("PUT", `/api/provider-nodes/${id}`, data);
}

async function deleteProviderNode(id) {
  return makeRequest("DELETE", `/api/provider-nodes/${id}`);
}

async function validateProviderNode(data) {
  return makeRequest("POST", "/api/provider-nodes/validate", data);
}

// ============================================================================
// TUNNEL API
// ============================================================================

/**
 * Get tunnel status
 * @returns {Promise<Object>} { success, data: { enabled, tunnelUrl, shortId, running } }
 */
async function getTunnelStatus() {
  return makeRequest("GET", "/api/tunnel/status");
}

/**
 * Enable tunnel
 * @returns {Promise<Object>} { success, data: { tunnelUrl, shortId } }
 */
async function enableTunnel() {
  return makeRequest("POST", "/api/tunnel/enable");
}

/**
 * Disable tunnel
 * @returns {Promise<Object>} { success, data: { success } }
 */
async function disableTunnel() {
  return makeRequest("POST", "/api/tunnel/disable");
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  configure,
  getCliToken,
  
  // Providers
  getProviders,
  getProviderById,
  testProvider,
  deleteProvider,
  getProviderModels,
  
  // Connection aliases
  testConnection: testProvider,
  deleteConnection: deleteProvider,
  updateConnection,
  
  // OAuth
  getOAuthAuthUrl,
  exchangeOAuthCode,
  getOAuthDeviceCode,
  pollOAuthToken,
  cancelOAuthFlow,
  createApiKeyProvider,
  
  // API Keys
  getApiKeys,
  createApiKey,
  updateApiKey,
  deleteApiKey,
  
  // Combos
  getCombos,
  getComboById,
  createCombo,
  updateCombo,
  deleteCombo,
  
  // CLI Tools
  getCliToolSettings,
  applyCliToolSettings,
  resetCliToolSettings,

  // Settings
  getSettings,
  updateSettings,
  updateConnectionAutoPing,
  resetPassword,
  
  // Tunnel
  getTunnelStatus,
  enableTunnel,
  disableTunnel,
  
  // Models
  getModels,
  getAvailableModels,

  // Provider Nodes (custom providers)
  getProviderNodes,
  createProviderNode,
  updateProviderNode,
  deleteProviderNode,
  validateProviderNode,
};
