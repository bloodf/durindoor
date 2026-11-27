import { isString } from "../../../../shared/utils/typeChecks.js";
import { validateImportToken } from "../../services/devin-desktop.js";

/** Apply OmniRoute's Devin import-token validation before mapping a CLI credential. */
export function mapDevinCliImport(tokens) {
  const value = isString(tokens) ? tokens : tokens?.accessToken ?? tokens?.access_token ?? tokens?.token;
  if (!isString(value)) throw new Error("Invalid token payload");
  const verdict = validateImportToken(value);
  if (!verdict.valid) throw new Error(verdict.reason);
  return {
    accessToken: value.trim(),
    refreshToken: null,
    expiresIn: tokens?.expiresIn || null,
    providerSpecificData: { authKind: "import_token" },
  };
}
