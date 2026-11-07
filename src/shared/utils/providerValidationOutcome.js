/** Map an API validation response to the credential-check label. */
export function providerValidationOutcome(data) {
  return data?.skipped ? "skipped" : data?.unavailable ? "unavailable" : data?.valid ? "success" : "failed";
}
