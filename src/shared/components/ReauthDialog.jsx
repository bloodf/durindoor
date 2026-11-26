"use client";

import Button from "@/shared/ui/components/Button.jsx";
import Input from "@/shared/ui/components/Input.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";

/**
 * Dialog for `usePasswordPrompt`: asks for the dashboard password, plus the
 * MFA code when the server's refusal says one is needed.
 *
 * @param {{ prompt: object }} props `prompt` as returned by the hook.
 */
export default function ReauthDialog({ prompt }) {
  const { open, password, setPassword, mfaCode, setMfaCode, mfaRequired, finish } = prompt;
  const ready = Boolean(password) && (!mfaRequired || Boolean(mfaCode.trim()));
  const submit = (event) => {
    event.preventDefault();
    if (ready) finish(password, mfaRequired ? mfaCode.trim() : "");
  };
  return (
    <Modal open={open} title="Confirm password" size="sm" onClose={() => finish(null)}>
      <form className="flex flex-col gap-4" onSubmit={submit}>
        <p className="text-[13px] text-dd-muted">This change lowers protection, redirects or records traffic, or changes who can sign in. Enter your current dashboard password to continue.</p>
        <Input label="Dashboard password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
        {mfaRequired ? <Input label="MFA code" hint="Authenticator code or backup code" autoComplete="one-time-code" value={mfaCode} onChange={(event) => setMfaCode(event.target.value)} /> : null}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="primary" disabled={!ready} className="flex-1">Confirm</Button>
          <Button type="button" variant="ghost" onClick={() => finish(null)} className="flex-1">Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}
