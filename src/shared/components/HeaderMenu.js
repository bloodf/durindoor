"use client";

import { useState, useEffect, useRef } from "react";
import PropTypes from "prop-types";
import { useTheme } from "@/shared/hooks/useTheme";
import ConfirmDialog from "@/shared/ui/components/ConfirmDialog.jsx";
import ChangelogModal from "./ChangelogModal";
function MenuItem({ icon, label, onClick, trailing, danger }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-11 w-full items-center gap-3 rounded-dd px-4 py-2 text-[13px] outline-none transition-colors focus-visible:shadow-dd-focus ${
        danger
          ? "text-dd-danger hover:bg-dd-danger/10"
          : "text-dd-text hover:bg-dd-surface-2"
      }`}
    >
      <span aria-hidden="true" className={`material-symbols-outlined text-[20px] ${danger ? "" : "text-dd-muted"}`}>
        {icon}
      </span>
      <span className="flex-1 text-left">{label}</span>
      {trailing && <span className="text-base">{trailing}</span>}
    </button>
  );
}

MenuItem.propTypes = {
  icon: PropTypes.string.isRequired,
  label: PropTypes.string.isRequired,
  onClick: PropTypes.func.isRequired,
  trailing: PropTypes.node,
  danger: PropTypes.bool,
};

export default function HeaderMenu({ onLogout }) {
  const [isOpen, setIsOpen] = useState(false);
  const [changelogOpen, setChangelogOpen] = useState(false);
  const [shutdownOpen, setShutdownOpen] = useState(false);
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const { toggleTheme, isDark } = useTheme();
  const menuRef = useRef(null);

  const handleShutdown = async () => {
    setIsShuttingDown(true);
    try {
      await fetch("/api/version/shutdown", { method: "POST" });
    } catch (e) {
      // Expected to fail as server shuts down; ignore error
    }
    setIsShuttingDown(false);
    setShutdownOpen(false);
  };

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  const close = () => setIsOpen(false);

  return (
    <>
      <div className="relative" ref={menuRef}>
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-dd text-dd-muted outline-none transition-colors hover:bg-dd-surface-2 hover:text-dd-text focus-visible:shadow-dd-focus"
          aria-label="Open application menu"
          aria-expanded={isOpen}
          title="Menu"
        >
          <span aria-hidden="true" className="material-symbols-outlined">grid_view</span>
        </button>

        {isOpen && (
          <div className="absolute end-0 top-full z-50 mt-2 w-60 overflow-hidden rounded-dd-lg border border-dd-border bg-dd-surface py-1 shadow-dd-elevated">
            <MenuItem icon="history" label="Change Log" onClick={() => { close(); setChangelogOpen(true); }} />
            <MenuItem icon={isDark ? "light_mode" : "dark_mode"} label="Theme" onClick={() => { toggleTheme(); close(); }} />
            <MenuItem icon="power_settings_new" label="Shutdown" danger onClick={() => { close(); setShutdownOpen(true); }} />
            <MenuItem icon="logout" label="Logout" danger onClick={() => { close(); onLogout(); }} />
          </div>
        )}
      </div>

      <ChangelogModal isOpen={changelogOpen} onClose={() => setChangelogOpen(false)} />
      <ConfirmDialog
        open={shutdownOpen}
        title="Close Proxy"
        message="Are you sure you want to close the proxy server?"
        confirmLabel={isShuttingDown ? "Closing…" : "Close"}
        tone="danger"
        pending={isShuttingDown}
        onConfirm={handleShutdown}
        onCancel={() => setShutdownOpen(false)}
      />
    </>
  );
}

HeaderMenu.propTypes = {
  onLogout: PropTypes.func.isRequired,
};
