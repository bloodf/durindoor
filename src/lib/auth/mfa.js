// MFA state + second-factor verification shared by the login and enrollment routes.
import { getSettings, updateSettings } from "@/lib/localDb";
import { consumeBackupCodeAtomic } from "@/lib/db/repos/settingsRepo.js";
import { verifyTotpCode } from "./totp.js";
import { findBackupCodeHashIndexSync } from "./backupCodes.js";

/** True when a second factor must be presented for password logins. */
export function isMfaEnabled(settings) {
  return settings?.mfaEnabled === true && !!settings?.mfaSecret;
}

export async function isMfaEnabledNow() {
  return isMfaEnabled(await getSettings());
}

/**
 * Verify a second factor. Accepts a 6-digit TOTP or a single-use backup code.
 * A consumed backup code is removed from storage before this resolves, so a
 * replay of the same code fails.
 *
 * Returns { ok, method, backupCodesRemaining }.
 */
export async function verifySecondFactor(input) {
  const settings = await getSettings();
  if (!isMfaEnabled(settings)) return { ok: false, method: null };

  const candidate = String(input || "").trim();
  if (!candidate) return { ok: false, method: null };

  // A bare 6-digit value is a TOTP; anything else can only be a backup code.
  if (/^\d{6}$/.test(candidate.replace(/\s/g, ""))) {
    if (verifyTotpCode(settings.mfaSecret, candidate)) {
      return {
        ok: true,
        method: "totp",
        backupCodesRemaining: (settings.mfaBackupCodes || []).length,
      };
    }
    return { ok: false, method: null };
  }

  // Atomic: re-reads the stored hashes and removes the matched one inside a
  // single transaction, so two concurrent verifications (including a replay
  // of the SAME code) can never both succeed against a pre-write snapshot.
  // See settingsRepo.js consumeBackupCodeAtomic for why the naive
  // read-then-write version was a TOCTOU race (decolua/9router#4144).
  const { matched, backupCodesRemaining } = await consumeBackupCodeAtomic(
    candidate,
    findBackupCodeHashIndexSync,
  );
  if (!matched) return { ok: false, method: null };

  return { ok: true, method: "backup", backupCodesRemaining };
}

/** Turn MFA off and wipe every stored secret/recovery hash. */
export async function disableMfa() {
  await updateSettings({ mfaEnabled: false, mfaSecret: "", mfaBackupCodes: [] });
}
