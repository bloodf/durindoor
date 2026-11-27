/** Guard unsupported Qoder web actions before allocating a flow or making a request. */
export function assertQoderWebAction(provider, action) {
  if ((provider === "qoder" || provider === "qoder-cn") &&
      ["authorize", "exchange", "import-token"].includes(action)) {
    const error = new Error("Qoder supports device sign-in; use the device-code action");
    error.code = "OAUTH_VALIDATION_FAILED";
    throw error;
  }
}
