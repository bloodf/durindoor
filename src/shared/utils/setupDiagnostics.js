/**
 * @typedef {Object} SetupFix
 * @property {string} label Imperative one-liner.
 * @property {string} [command] Exact copy-pasteable command.
 * @property {string} [url]
 */

/**
 * @typedef {Object} SetupDiagnostic
 * @property {string} code Stable SCREAMING_SNAKE code.
 * @property {string} summary One-line measured problem statement.
 * @property {string} detail Observed configuration facts.
 * @property {SetupFix[]} fixes Ordered remediation actions.
 * @property {string} [docs]
 * @property {string} [logTail]
 */

const USER_FIXABLE_CODES = new Set([
  "NO_SUPPORTED_PYTHON",
  "PYTHON_USER_SCOPED_ONLY",
  "VENV_TOOLS_MISSING",
  "VENV_CREATE_FAILED",
  "INSTALL_FAILED",
  "PEP668",
  "EXTRA_WHEEL_UNAVAILABLE",
  "NOT_INSTALLED",
  "EARLY_EXIT",
  "EXTERNAL_PROXY",
  "VENV_UNTRUSTED",
  "UNKNOWN_EXTRA",
  "INSTALL_IN_PROGRESS",
  "INSTALL_DISK_FULL",
  "INSTALL_TIMEOUT",
]);

/**
 * Quote a value for safe interpolation into a copy-pasteable shell command
 * shown in a diagnostic fix. POSIX: single-quote wrap, escaping embedded
 * single quotes as `'\''`. Windows: double-quote wrap, escaping embedded
 * double quotes as `\"`.
 *
 * Failure modes: none; non-string input is coerced with `String()`.
 *
 * @param {string} value
 * @returns {string}
 */
export function quoteShellArg(value) {
  const text = String(value);
  if (process.platform === "win32") {
    return `"${text.replace(/"/g, '\\"')}"`;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

const URL_CREDENTIALS_RE = /(\w+:\/\/)[^\s@/]+:[^\s@/]+@/g;
// Token-shaped runs only. A long hyphenated phrase such as
// "externally-managed-environment" or a package name like
// "tree-sitter-language-pack" MUST survive: redacting those destroys both the
// operator's log and the classification that reads it. Require the mixed
// letter+digit shape that real secrets have.
const TOKEN_RUN_RE = /\b(?=[A-Za-z0-9_-]{20,}\b)(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]+\b/g;
const PIP_INDEX_URL_ENV_RE = /(PIP_INDEX_URL\s*=\s*)\S+/g;
const EXTRA_INDEX_URL_FLAG_RE = /(--extra-index-url[= ])\S+/g;

/**
 * Redact credentials and token-shaped substrings from captured subprocess
 * output before it is stored in a diagnostic's `logTail` or `detail`.
 *
 * Failure modes: none; non-string input returns an empty string.
 *
 * @param {string} text
 * @returns {string}
 */
export function redactSensitive(text) {
  if (typeof text !== "string") return "";
  return text
    .replace(PIP_INDEX_URL_ENV_RE, "$1[redacted]")
    .replace(EXTRA_INDEX_URL_FLAG_RE, "$1[redacted]")
    .replace(URL_CREDENTIALS_RE, "$1[redacted]@")
    .replace(TOKEN_RUN_RE, "[redacted]");
}

/**
 * Create an immutable, operator-facing setup diagnostic.
 *
 * Failure modes: throws TypeError when required text is absent or `fixes` is empty.
 *
 * @param {SetupDiagnostic} diagnostic
 * @returns {Readonly<SetupDiagnostic>}
 */
export function createDiagnostic({ code, summary, detail, fixes, docs, logTail }) {
  if (![code, summary, detail].every((value) => typeof value === "string" && value.trim())) {
    throw new TypeError("Setup diagnostics require code, summary, and detail");
  }
  if (!Array.isArray(fixes) || fixes.length === 0 || fixes.some((fix) => !fix || typeof fix.label !== "string" || !fix.label.trim())) {
    throw new TypeError("Setup diagnostics require at least one labeled fix");
  }

  return Object.freeze({
    code,
    summary,
    detail,
    fixes: Object.freeze(fixes.map((fix) => Object.freeze({ ...fix }))),
    ...(docs ? { docs } : {}),
    ...(logTail !== undefined ? { logTail } : {}),
  });
}

/**
 * Error carrying a structured setup diagnostic.
 *
 * Failure modes: none; callers receive the supplied diagnostic as `.diagnostic`.
 */
export class SetupError extends Error {
  constructor(diagnostic) {
    super(diagnostic.summary);
    this.name = "SetupError";
    this.diagnostic = diagnostic;
    this.code = diagnostic.code;
  }
}

/**
 * Convert a setup diagnostic to the API failure shape.
 *
 * Failure modes: none.
 *
 * @param {SetupDiagnostic} diagnostic
 * @returns {{ok: false, diagnostic: SetupDiagnostic, error: string}}
 */
export function toDiagnosticResponse(diagnostic) {
  return { ok: false, diagnostic, error: diagnostic.summary };
}

/**
 * Tell API routes whether a setup failure can be repaired by an operator.
 *
 * Failure modes: unknown codes return false.
 *
 * @param {string} code
 * @returns {boolean}
 */
export function isUserFixable(code) {
  return USER_FIXABLE_CODES.has(code);
}
