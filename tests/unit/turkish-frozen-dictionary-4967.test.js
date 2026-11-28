import { describe, expect, it } from "vitest";
import english from "../../public/i18n/literals/en.json";
import turkish from "../../public/i18n/literals/tr.json";

// Keys already present before #4967 that are absent from the current English catalog.
const existingNonEnglishKeys = [
  "Actions",
  "Advanced",
  "All data stored on your machine",
  "Antigravity/Copilot IDE request → DNS redirect to localhost:443 → MITM proxy intercepts → 9Router → response to Antigravity/Copilot",
  "Basic",
  "Count",
  "Cut",
  "Dark",
  "Date",
  "Default",
  "Description",
  "Disconnected",
  "Enabled",
  "Enter your sudo password to start/stop MITM server",
  "Export",
  "Failed",
  "Failed to start server",
  "Failed to stop server",
  "Filter",
  "Help",
  "Info",
  "Intercept CLI tool traffic and route through 9Router",
  "Light",
  "Loading",
  "New",
  "No",
  "No API keys — create one in Keys page",
  "OK",
  "Offline",
  "Online",
  "Optional",
  "Paste",
  "Previous",
  "Price",
  "Profile",
  "Redo",
  "Required",
  "Search",
  "Server started",
  "Server stopped — all DNS cleared",
  "Sort",
  "Submit",
  "Success",
  "Sudo Password",
  "Support",
  "Time",
  "Total",
  "Type",
  "Undo",
  "Updated",
  "Upload",
  "Use Antigravity IDE & GitHub Copilot → with ANY provider/model from 9Router",
  "Version",
  "View",
  "Yes"
];
const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

describe("frozen #4967 Turkish dictionary", () => {
  it("provides source-backed labels and retains the local Save translation", () => {
    expect(turkish["API Keys"]).toBe("API Anahtarları");
    expect(turkish.Tomorrow).toBe("Yarın");
    expect(turkish.Save).toBe("Kaydet");
  });

  it("adds only keys in the current English dictionary", () => {
    expect(Object.keys(turkish).filter((key) => !(key in english)).sort()).toEqual(existingNonEnglishKeys);
  });

  it("preserves interpolation parameters", () => {
    for (const [key, value] of Object.entries(turkish)) {
      expect(placeholders(value), key).toEqual(placeholders(key));
    }
  });
});
