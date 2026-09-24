"use client";

import { useState } from "react";
import PropTypes from "prop-types";
import Modal from "@/shared/ui/components/Modal";
import Button from "@/shared/ui/components/Button";
import Input from "@/shared/ui/components/Input";
import OAuthModal from "./OAuthModal";

/** Mirror of the server check: https origin only. Returns null when invalid. */
export function toGheOrigin(value) {
  try {
    const url = new URL(String(value || "").trim());
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * GitHub Enterprise Copilot connect flow: ask for the enterprise URL, then run
 * the standard device-code OAuthModal against that host.
 */
export default function GheCopilotAuthModal({
  isOpen,
  providerInfo,
  onSuccess,
  onClose,
  proxyPools = [],
  proxyPoolsReady = false
}) {
  const [gheUrl, setGheUrl] = useState("");
  const [error, setError] = useState(null);
  const [oauthMeta, setOauthMeta] = useState(null);

  const handleClose = () => {
    setGheUrl("");
    setError(null);
    setOauthMeta(null);
    onClose();
  };

  const handleContinue = () => {
    const origin = toGheOrigin(gheUrl);
    if (!origin) {
      setError("Enter an https URL, for example https://ghe.company.com");
      return;
    }
    setError(null);
    setOauthMeta({ gheUrl: origin });
  };

  if (!isOpen) return null;

  if (oauthMeta) {
    return (
      <OAuthModal
        isOpen
        provider="ghe-copilot"
        providerInfo={providerInfo}
        oauthMeta={oauthMeta}
        proxyPools={proxyPools}
        proxyPoolsReady={proxyPoolsReady}
        onSuccess={() => {onSuccess?.();handleClose();}}
        onClose={() => setOauthMeta(null)} />);

  }

  return (
    <Modal open={isOpen} title="Connect GitHub Enterprise Copilot" onClose={handleClose} size="md">
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-dd-muted">
          Enter your GitHub Enterprise address. You will then sign in there with a device code.
        </p>
        <Input
          label="GitHub Enterprise URL"
          value={gheUrl}
          onChange={(e) => setGheUrl(e.target.value)}
          placeholder="https://ghe.company.com"
          error={error || undefined} />

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={handleClose} variant="ghost">Cancel</Button>
          <Button onClick={handleContinue} variant="primary" disabled={!gheUrl.trim()} icon="login">Continue</Button>
        </div>
      </div>
    </Modal>);

}

GheCopilotAuthModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  providerInfo: PropTypes['shape']({ name: PropTypes.string }),
  onSuccess: PropTypes.func,
  onClose: PropTypes.func.isRequired,
  proxyPools: PropTypes.arrayOf(PropTypes['shape']({
    id: PropTypes.string,
    name: PropTypes.string,
    isActive: PropTypes.bool
  })),
  proxyPoolsReady: PropTypes.bool
};
