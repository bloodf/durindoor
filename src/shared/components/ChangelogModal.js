"use client";

import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { marked } from "marked";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import Modal from "@/shared/ui/components/Modal.jsx";
import { GITHUB_CONFIG } from "@/shared/constants/config";

const ALLOWED_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeLinkHref(href) {
  try {
    const url = new URL(String(href), "https://durindoor.local");
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

// marked v18 renderer entries must return strings. Raw HTML is escaped and
// links are protocol-restricted before this trusted sink renders Markdown.
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    html(token) {
      return escapeHtml(token?.text ?? "");
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const safeHref = sanitizeLinkHref(href);
      if (!safeHref) return text;
      const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
      return `<a href="${escapeHtml(safeHref)}"${titleAttr} rel="noopener noreferrer nofollow" target="_blank">${text}</a>`;
    },
  },
});

export default function ChangelogModal({ isOpen, onClose }) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [loaded, setLoaded] = useState(false);
  const activeRequestIdRef = useRef(0);

  useEffect(() => {
    if (!isOpen || loaded) return undefined;
    const controller = new AbortController();
    const requestId = activeRequestIdRef.current + 1;
    activeRequestIdRef.current = requestId;
    setLoading(true);
    setError("");
    fetch(GITHUB_CONFIG.changelogUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((markdown) => {
        if (activeRequestIdRef.current !== requestId) return;
        setHtml(marked.parse(markdown));
        setLoaded(true);
      })
      .catch((err) => {
        if (err.name === "AbortError" || activeRequestIdRef.current !== requestId) return;
        setError(err.message || "Failed to load");
        setLoaded(true);
      })
      .finally(() => {
        if (activeRequestIdRef.current === requestId) setLoading(false);
      });
    return () => {
      controller.abort();
      activeRequestIdRef.current += 1;
    };
  }, [isOpen, loaded]);

  return (
    <Modal open={isOpen} onClose={onClose} title="Change Log" size="lg">
      <div role="status" aria-live="polite" className="sr-only">
        {loading || !loaded ? "Loading changelog" : error ? "Failed to load changelog" : "Changelog loaded"}
      </div>
      {loading || !loaded ? (
        <div className="flex items-center justify-center gap-2 py-10 text-dd-muted">
          <span aria-hidden="true" className="material-symbols-outlined animate-spin text-[18px] leading-none">progress_activity</span>
          Loading…
        </div>
      ) : error ? (
        <div role="alert" className="rounded-dd border border-dd-danger/30 bg-dd-danger/10 px-3 py-2 text-dd-danger">
          Failed to load changelog: {error}
        </div>
      ) : html ? (
        <div
          className="text-[13px] leading-relaxed text-dd-text [&_a]:rounded-dd [&_a]:text-dd-accent [&_a]:underline [&_a]:outline-none [&_a:focus-visible]:shadow-dd-focus [&_code]:rounded-dd [&_code]:bg-dd-surface-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-dd-text [&_h1]:mb-3 [&_h1]:mt-0 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-semibold [&_hr]:my-5 [&_hr]:border-dd-border-subtle [&_li]:my-1 [&_ol>li]:list-decimal [&_ul>li]:list-disc [&_p]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-dd [&_pre]:bg-dd-bg-alt [&_pre]:p-3 [&_pre]:text-dd-muted [&_strong]:font-semibold [&_strong]:text-dd-text"
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <EmptyState
          icon="article"
          title="No changelog entries"
          message="The changelog is available, but it does not contain any entries yet."
        />
      )}
    </Modal>
  );
}

ChangelogModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};
