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
]);

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
 * @returns {{ok: false, diagnostic: SetupDiagnostic}}
 */
export function toDiagnosticResponse(diagnostic) {
  return { ok: false, diagnostic };
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
