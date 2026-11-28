"use client";

import { requestSettings } from "@/store/settingsStore";

import { useState, useRef } from "react";
import api from "@/shared/utils/api";
import useSettingsStore from "@/store/settingsStore";

/** Password-confirmed database export and import for the profile page. */
export function useDatabaseBackup(setSettings) {
  const [dbLoading, setDbLoading] = useState(false);
  const [dbStatus, setDbStatus] = useState({ type: "", message: "" });
  const [dbAuth, setDbAuth] = useState({ open: false, mode: "", password: "" });
  const pendingImportRef = useRef(null);
  const importFileRef = useRef(null);

  const reloadSettings = async () => {
    try {
      const res = await requestSettings();
      if (!res.ok) return;
      const data = await res.json();
      setSettings(data);
    } catch (err) {
      console.error("Failed to reload settings:", err);
    }
  };

  const handleExportDatabase = async (password) => {
    setDbLoading(true);
    setDbStatus({ type: "", message: "" });
    try {
      const payload = await api.get("/api/settings/database", {
        headers: { "x-9r-password": password }
      });
      if (payload == null) throw new Error("Failed to export database");

      const content = JSON.stringify(payload, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      anchor.href = url;
      anchor.download = `durindoor-backup-${stamp}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);

      setDbStatus({ type: "success", message: "Database backup downloaded" });
    } catch (err) {
      setDbStatus({
        type: "error",
        message: err?.body?.error || (err?.status !== undefined ? "Failed to export database" : err.message) || "Failed to export database"
      });
    } finally {
      setDbLoading(false);
    }
  };

  const handleImportDatabase = (event) => {
    const file = event.target.files?.[0];
    if (importFileRef.current) importFileRef.current.value = "";
    if (!file) return;
    pendingImportRef.current = file;
    setDbStatus({ type: "", message: "" });
    setDbAuth({ open: true, mode: "import", password: "" });
  };

  const runImportDatabase = async (password) => {
    const file = pendingImportRef.current;
    if (!file) return;
    setDbLoading(true);
    try {
      const raw = await file.text();
      const payload = JSON.parse(raw);

      await api.post("/api/settings/database", { ...payload, password });

      useSettingsStore.getState().invalidate();
      await reloadSettings();
      setDbStatus({ type: "success", message: "Database imported successfully" });
    } catch (err) {
      setDbStatus({
        type: "error",
        message: err?.body?.error || (err?.status !== undefined ? "Failed to import database" : err.message) || "Invalid backup file"
      });
    } finally {
      pendingImportRef.current = null;
      setDbLoading(false);
    }
  };

  // Confirm password modal, then run export or import.
  const handleDbAuthConfirm = async () => {
    const { mode, password } = dbAuth;
    setDbAuth({ open: false, mode: "", password: "" });
    if (mode === "export") await handleExportDatabase(password);else
    if (mode === "import") await runImportDatabase(password);
  };

  return {
    dbLoading, dbStatus, dbAuth, setDbAuth, importFileRef,
    handleImportDatabase, handleDbAuthConfirm
  };
}
