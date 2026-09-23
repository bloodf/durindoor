// Forward the caller's own Codex CLI version instead of only ever advertising
// our pinned default. OpenAI's backend gates some models on client version
// ("The 'gpt-6-astra' model requires a newer version of Codex."), so a caller
// running a newer real codex-cli than our pin should have its version reach
// the wire, not be clamped down to ours.
// Upstream provenance: diegosouzapw/OmniRoute fa23670ea (#13708).
import { readNamedHeader } from "./codexIdentity.js";
import { CODEX_CLI_VERSION } from "./appConstants.js";
import { isString } from "../../src/shared/utils/typeChecks.js";

const SAFE_HEADER_TOKEN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;
const CODEX_UA_VERSION_PATTERN = /(?:codex[-_][A-Za-z0-9_]*|codex-cli)\/(\d+\.\d+\.\d+)/i;

/**
 * Resolve the caller's Codex CLI version from the inbound `Version` header
 * (case-insensitive) or, failing that, a `codex_cli_rs/x.y.z`-shaped
 * `User-Agent`. Returns `null` when neither yields a usable version, so the
 * caller can fall back to the pinned default.
 *
 * @param {Headers|Record<string,string>|null} clientHeaders Inbound request headers.
 * @returns {string|null} Caller-reported Codex CLI version, or `null`.
 */
export function getCodexClientVersionFromHeaders(clientHeaders) {
  const versionHeader = readNamedHeader(clientHeaders, "version");
  if (versionHeader && SAFE_HEADER_TOKEN_PATTERN.test(versionHeader)) return versionHeader;
  const userAgent = readNamedHeader(clientHeaders, "user-agent");
  const match = userAgent.match(CODEX_UA_VERSION_PATTERN);
  return match ? match[1] : null;
}

/**
 * Compare two `x.y.z` version strings. Missing/non-numeric segments read as 0.
 *
 * @param {string} a First version.
 * @param {string} b Second version.
 * @returns {number} Negative, zero, or positive as `a` is less than, equal to, or greater than `b`.
 */
function compareVersionParts(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Whether our advertised Codex CLI version satisfies a model catalog entry's
 * `minimal_client_version` gate. A missing/non-string gate always passes.
 * Upstream provenance: diegosouzapw/OmniRoute d5452d03e (#12933).
 *
 * @param {unknown} minimalClientVersion Catalog entry's `minimal_client_version` field.
 * @returns {boolean} `true` when CODEX_CLI_VERSION is new enough (or the gate is absent).
 */
export function meetsMinimalCodexClientVersion(minimalClientVersion) {
  if (!isString(minimalClientVersion) || !minimalClientVersion) return true;
  return compareVersionParts(CODEX_CLI_VERSION, minimalClientVersion) >= 0;
}
