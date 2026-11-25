"use client";

import { useCallback, useRef, useState } from "react";

/**
 * State for the "enter your current password" dialog behind a settings write
 * the server answers with REAUTH_REQUIRED. Pass `confirmPassword` to
 * `patchSettings` / `requestSettings` and render a dialog from `prompt`.
 *
 * `confirmPassword()` resolves the typed password, or null when dismissed.
 */
export function usePasswordPrompt() {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const resolver = useRef(null);

  const finish = useCallback((value) => {
    setOpen(false);
    setPassword("");
    resolver.current?.(value);
    resolver.current = null;
  }, []);

  const confirmPassword = useCallback(() => new Promise((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setOpen(true);
  }), []);

  return { confirmPassword, prompt: { open, password, setPassword, finish } };
}
