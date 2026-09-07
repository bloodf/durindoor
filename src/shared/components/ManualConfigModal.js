"use client";

import { useEffect, useRef, useState } from "react";
import Modal from "@/shared/ui/components/Modal.jsx";
import Button from "@/shared/ui/components/Button.jsx";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";

export default function ManualConfigModal({ isOpen, onClose, title = "Manual Configuration", configs = [] }) {
  const { copy } = useCopyToClipboard();
  const [copiedIndex, setCopiedIndex] = useState(null);
  const timerRef = useRef(null);
  useEffect(() => {
    if (!isOpen) setCopiedIndex(null);
    return () => clearTimeout(timerRef.current);
  }, [isOpen]);
  const copyConfig = (text, index) => {
    clearTimeout(timerRef.current);
    copy(text, `manualconfig-${index}`);
    setCopiedIndex(index);
    timerRef.current = setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <Modal open={isOpen} onClose={onClose} title={title} size="xl">
      <div className="flex flex-col gap-5">
        {configs.map((config, index) => (
          <section key={index} aria-label={config.filename} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-[13px] font-semibold text-dd-text">{config.filename}</span>
              <Button
                variant="ghost"
                size="sm"
                icon={copiedIndex === index ? "check" : "content_copy"}
                onClick={() => copyConfig(config.content, index)}
              >
                {copiedIndex === index ? "Copied!" : "Copy"}
              </Button>
            </div>
            {/* `pre` exposes no implicit role, so ARIA prohibits a name on it
                and assistive tech drops the label. `region` legitimately
                accepts one, and the block is independently scrollable, so it
                is focusable for keyboard users too. */}
            <pre role="region" tabIndex={0} aria-label={`${config.filename} contents`} className="max-h-60 overflow-auto rounded-dd border border-dd-border bg-dd-surface-2 px-3 py-3 font-mono text-xs text-dd-text whitespace-pre-wrap break-all outline-none focus-visible:shadow-dd-focus">{config.content}</pre>
          </section>
        ))}
      </div>
    </Modal>
  );
}
