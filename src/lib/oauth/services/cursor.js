import { CURSOR_CONFIG } from "../constants/oauth.js";

/**
 * Cursor IDE OAuth Service
 * Supports Import Token method from Cursor IDE's local SQLite database
 *
 * Token Location:
 * - Linux: ~/.config/Cursor/User/globalStorage/state.vscdb
 * - macOS: /Users/<user>/Library/Application Support/Cursor/User/globalStorage/state.vscdb
 * - Windows: %APPDATA%\Cursor\User\globalStorage\state.vscdb
 *
 * Database Keys:
 * - cursorAuth/accessToken: The access token
 * - storage.serviceMachineId: Machine ID for checksum
 */
import { isString, isUndefined } from "../../../shared/utils/typeChecks.js";

export function isCursorEmail(value) {
  return isString(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isAuth0Subject(value) {
  return isString(value) && /^auth0\|user_/i.test(value);
}

export const CURSOR_FALLBACK_TOKEN_TTL_SECONDS = 86400;

/**
 * Seconds until an imported access token's JWT `exp`; opaque tokens get the
 * 24-hour estimate. A zero or negative result means the token already expired.
 * Mirrors OmniRoute `resolveCursorTokenTtlSeconds` in
 * src/lib/oauth/services/cursor.ts @ b15b2ee6ac0f57af254be4a3cc60ba8a6cc9a523 (MIT).
 */
export function resolveCursorTokenTtlSeconds(accessToken, nowMs = Date.now()) {
  const parts = isString(accessToken) ? accessToken.split(".") : [];
  if (parts.length !== 3) return CURSOR_FALLBACK_TOKEN_TTL_SECONDS;
  try {
    const exp = JSON.parse(Buffer.from(parts[1], "base64url").toString())?.exp;
    if (!Number.isFinite(exp)) return CURSOR_FALLBACK_TOKEN_TTL_SECONDS;
    return Math.floor((exp * 1000 - nowMs) / 1000);
  } catch {
    return CURSOR_FALLBACK_TOKEN_TTL_SECONDS;
  }
}

export class CursorService {
  constructor() {
    this.config = CURSOR_CONFIG;
  }

  /**
   * Generate Cursor checksum (jyh cipher)
   * Algorithm: XOR timestamp bytes with rolling key (initial 165), then base64 encode
   * Format: {encoded_timestamp},{machineId}
   */
  generateChecksum(machineId) {
    const timestamp = Math.floor(Date.now() / 1000).toString();
    let key = 165;
    const encoded = [];

    for (let i = 0; i < timestamp.length; i++) {
      const charCode = timestamp.charCodeAt(i);
      encoded.push(charCode ^ key);
      key = key + charCode & 0xff; // Rolling key update
    }

    const base64Encoded = Buffer.from(encoded).toString("base64");
    return `${base64Encoded},${machineId}`;
  }

  /**
   * Build request headers for Cursor API
   */
  buildHeaders(accessToken, machineId, ghostMode = false) {
    const checksum = this.generateChecksum(machineId);

    return {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/connect+proto",
      "Connect-Protocol-Version": "1",
      "x-cursor-client-version": this.config.clientVersion,
      "x-cursor-client-type": this.config.clientType,
      "x-cursor-client-os": this.detectOS(),
      "x-cursor-client-arch": this.detectArch(),
      "x-cursor-client-device-type": "desktop",
      "x-cursor-checksum": checksum,
      "x-ghost-mode": ghostMode ? "true" : "false"
    };
  }

  /**
   * Detect OS for headers
   */
  detectOS() {
    if (!isUndefined(globalThis.process)) {
      const platform = process.platform;
      if (platform === "win32") return "windows";
      if (platform === "darwin") return "macos";
      return "linux";
    }
    return "linux";
  }

  /**
   * Detect architecture for headers
   */
  detectArch() {
    if (!isUndefined(globalThis.process)) {
      const arch = process.arch;
      if (arch === "x64") return "x86_64";
      if (arch === "arm64") return "aarch64";
      return arch;
    }
    return "x86_64";
  }

  /**
   * Validate and import token from Cursor IDE
   * Note: We skip API validation because Cursor API uses complex protobuf format.
   * Token will be validated when actually used for requests.
   * @param {string} accessToken - Access token from state.vscdb
   * @param {string} machineId - Machine ID from state.vscdb
   */
  async validateImportToken(accessToken, machineId) {
    // Basic validation
    if (!accessToken || !isString(accessToken)) {
      throw new Error("Access token is required");
    }

    if (!machineId || !isString(machineId)) {
      throw new Error("Machine ID is required");
    }

    // Token format validation (Cursor tokens are typically long strings)
    if (accessToken.length < 50) {
      throw new Error("Invalid token format. Token appears too short.");
    }

    // Machine ID format validation (should be UUID-like)
    const uuidRegex = /^[a-f0-9-]{32,}$/i;
    if (!uuidRegex.test(machineId.replace(/-/g, ""))) {
      throw new Error("Invalid machine ID format. Expected UUID format.");
    }

    // No provider call: imported tokens are checked when first used. A JWT
    // that has already expired cannot be refreshed, so it is rejected here.
    const expiresIn = resolveCursorTokenTtlSeconds(accessToken);
    if (expiresIn <= 0) {
      throw new Error("Cursor token has expired. Sign in to Cursor again, then re-import.");
    }

    return {
      accessToken,
      machineId,
      expiresIn,
      authMethod: "imported"
    };
  }

  /**
   * Extract user info from token if possible
   * Cursor tokens may contain encoded user info
   */
  extractUserInfo(accessToken) {
    try {
      // Try to decode as JWT
      const parts = accessToken.split(".");
      if (parts.length === 3) {
        let payload = parts[1];
        while (payload.length % 4) {
          payload += "=";
        }
        const decoded = JSON.parse(
          Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString()
        );
        const userId = decoded.sub || decoded.user_id || null;
        const email = isCursorEmail(decoded.email) ? decoded.email : null;
        return { email, userId };
      }
    } catch {

      // Token is not a JWT, that's okay
    }
    return null;
  }

  /**
   * Resolve a human-readable identity for a Cursor connection.
   */
  resolveIdentity({ accessToken, cachedEmail, userId } = {}) {
    const tokenInfo = accessToken ? this.extractUserInfo(accessToken) : null;
    const resolvedUserId = userId || tokenInfo?.userId || null;
    const email = isCursorEmail(cachedEmail) ?
    cachedEmail :
    tokenInfo?.email || null;

    return {
      email,
      userId: resolvedUserId,
      name: email
    };
  }

  /**
   * Get token storage path instructions for user
   */
  getTokenStorageInstructions() {
    return {
      title: "How to get your Cursor token",
      steps: [
      "1. Open Cursor IDE and make sure you're logged in",
      "2. Find the state.vscdb file:",
      `   - Linux: ${this.config.tokenStoragePaths.linux}`,
      `   - macOS: ${this.config.tokenStoragePaths.macos}`,
      `   - Windows: ${this.config.tokenStoragePaths.windows}`,
      "3. Open the database with SQLite browser or CLI:",
      "   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='cursorAuth/accessToken'\"",
      "4. Also get the machine ID:",
      "   sqlite3 state.vscdb \"SELECT value FROM itemTable WHERE key='storage.serviceMachineId'\"",
      "5. Paste both values in the form below"],

      alternativeMethod: [
      "Or use this one-liner to get both values:",
      "sqlite3 state.vscdb \"SELECT key, value FROM itemTable WHERE key IN ('cursorAuth/accessToken', 'storage.serviceMachineId')\""]

    };
  }
}