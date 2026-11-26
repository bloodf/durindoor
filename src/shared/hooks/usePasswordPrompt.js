"use client";

import { useCallback, useRef, useState } from "react";

/**
 * State for the "enter your current password" dialog behind a settings write
 * the server answers with REAUTH_REQUIRED. Pass `confirmPassword` to
 * `patchSettings` / `requestSettings` and render a dialog from `prompt`.
 *
 * `confirmPassword(refusal)` takes the 401 body; `prompt.mfaRequired` follows
 * its `mfaRequired` flag. The dialog calls `prompt.finish(password, mfaCode)`.
 * The promise resolves the password, `{ currentPassword, mfaCode }` when a code
 * was entered too, or null when dismissed.
 */
export function usePasswordPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [mfaRequired, setMfaRequired] = useState(false);
  const resolver = useRef(null);

  const finish = useCallback((value, code) => {
    setOpen(false);
    setPassword("");
    setMfaCode("");
    resolver.current?.(value && code ? { currentPassword: value, mfaCode: code } : value);
    resolver.current = null;
  }, []);

  const confirmPassword = useCallback((refusal) => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setMfaRequired(refusal?.mfaRequired === true);
    setOpen(true);
  }), []);

  return { confirmPassword, prompt: { open, password, setPassword, mfaCode, setMfaCode, mfaRequired, finish } };
}
