// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React, { act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = React.createElement;

vi.mock("@/shared/ui/components/Modal.jsx", () => ({
  default: ({ open, children, footer }) => (open ? h("section", { "data-testid": "modal" }, children, footer) : null),
}));
vi.mock("@/shared/ui/components/Button.jsx", () => ({
  default: ({ children, onClick, disabled, type }) => h("button", { onClick, disabled, type }, children),
}));
vi.mock("@/shared/ui/components/Input.jsx", () => ({
  default: ({ label, value, onChange, disabled }) => h("label", null, label, h("input", { value, onChange, disabled })),
}));
vi.mock("@/shared/ui/components/Textarea.jsx", () => ({
  default: ({ label, value, onChange, disabled }) => h("label", null, label, h("textarea", { value, onChange, disabled })),
}));

import {
  MAX_HAR_FILE_BYTES,
  MAX_IMPORT_TEXT_LENGTH,
  parseCookieHeaderValue,
  parseCurlCommand,
  parseHarDocument,
  buildImportCandidates,
  candidatesAreAmbiguous,
  filterCandidateCookies,
} from "../../src/shared/utils/cookieImportParser.js";
import { resolveCookieImportContract } from "../../src/shared/utils/cookieImportContract.js";
import CookieImportModal from "../../src/app/(dashboard)/dashboard/providers/[id]/CookieImportModal.js";

const ORIGIN = "https://chatgpt.com";
const CHUNK_ZERO = "synthetic-session-chunk-zero";
const CHUNK_ONE = "synthetic-session-chunk-one";
const SINGLE = "synthetic-single-session-value";

const WEB_LOGIN = {
  origin: ORIGIN,
  cookieNames: ["__Secure-next-auth.session-token"],
  cookiePrefixes: ["__Secure-next-auth.session-token."],
};

const contract = resolveCookieImportContract(WEB_LOGIN);

const HAR = {
  log: {
    entries: [
      {
        request: {
          url: "https://chatgpt.com/backend-api/conversation",
          headers: [{ name: "Cookie", value: `__Secure-next-auth.session-token.0=${CHUNK_ZERO}; __Secure-next-auth.session-token.1=${CHUNK_ONE}` }],
          cookies: [],
        },
      },
      {
        request: {
          url: "https://chatgpt.com/api/auth/session",
          headers: [{ name: "cookie", value: `__Secure-next-auth.session-token.0=${CHUNK_ZERO}` }],
          cookies: [],
        },
      },
      {
        request: {
          url: "https://auth.openai.com/authorize",
          headers: [{ name: "Cookie", value: "auth_token=synthetic-other-origin" }],
          cookies: [],
        },
      },
    ],
  },
};

describe("cookie import parsing", () => {
  it("reads a raw Cookie header and keeps padded values intact", () => {
    const parsed = parseCookieHeaderValue(`Cookie: __Secure-next-auth.session-token.0=${CHUNK_ZERO}; session=${SINGLE}=`);
    expect(parsed.ok).toBe(true);
    expect(parsed.cookies).toEqual([
      { name: "__Secure-next-auth.session-token.0", value: CHUNK_ZERO },
      { name: "session", value: `${SINGLE}=` },
    ]);
  });

  it("drops input that is not a name=value pair instead of failing the whole paste", () => {
    const parsed = parseCookieHeaderValue("__Secure-next-auth.session-token=abc; ; broken; =empty");
    expect(parsed.ok).toBe(true);
    expect(parsed.cookies).toEqual([{ name: "__Secure-next-auth.session-token", value: "abc" }]);
    expect(parsed.skipped).toBe(2);
  });

  it("refuses input that carries no cookie at all", () => {
    expect(parseCookieHeaderValue("   ").ok).toBe(false);
    expect(parseCookieHeaderValue("not a cookie").ok).toBe(false);
  });

  it("reads the URL and the Cookie header out of a cURL command without running it", () => {
    const parsed = parseCurlCommand(`curl 'https://chatgpt.com/backend-api/conversation' \\\n  -H 'accept: */*' \\\n  -H 'Cookie: __Secure-next-auth.session-token.0=${CHUNK_ZERO}; __Secure-next-auth.session-token.1=${CHUNK_ONE}' \\\n  --data-raw '{}'`);
    expect(parsed.ok).toBe(true);
    expect(parsed.origin).toBe(ORIGIN);
    expect(parsed.cookies.map((cookie) => cookie.name)).toEqual([
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.session-token.1",
    ]);
  });

  it("refuses a cURL command that is not one or that names no request", () => {
    expect(parseCurlCommand("wget https://chatgpt.com").ok).toBe(false);
    expect(parseCurlCommand("curl -H 'Cookie: a=b'").ok).toBe(false);
    expect(parseCurlCommand("curl https://chatgpt.com/x").ok).toBe(false);
  });

  it("reads a HAR file and ignores requests to other origins", () => {
    const parsed = parseHarDocument(JSON.stringify(HAR));
    expect(parsed.ok).toBe(true);
    expect(parsed.entries.map((entry) => entry.origin)).toEqual([ORIGIN, ORIGIN, "https://auth.openai.com"]);
  });

  it("refuses a HAR file that is not JSON or has no entries", () => {
    expect(parseHarDocument("not json").ok).toBe(false);
    expect(parseHarDocument(JSON.stringify({ log: {} })).ok).toBe(false);
  });

  it("enforces the input size limits", () => {
    expect(parseCurlCommand(`curl https://chatgpt.com -H 'Cookie: a=${"x".repeat(MAX_IMPORT_TEXT_LENGTH)}'`).ok).toBe(false);
    expect(parseHarDocument("x".repeat(MAX_HAR_FILE_BYTES + 1)).ok).toBe(false);
  });
});

describe("cookie import candidates", () => {
  it("keeps only the provider cookies and reports the ignored names", () => {
    const filtered = filterCandidateCookies({
      origin: ORIGIN,
      url: null,
      cookies: [
        { name: "__Secure-next-auth.session-token.0", value: CHUNK_ZERO },
        { name: "__Secure-next-auth.session-token.1", value: CHUNK_ONE },
        { name: "cf_clearance", value: "synthetic-clearance" },
      ],
    }, contract);
    expect(filtered.ok).toBe(true);
    expect(filtered.cookies.map((cookie) => cookie.name)).toEqual([
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.session-token.1",
    ]);
    expect(filtered.dropped).toEqual(["cf_clearance"]);
  });

  it("keeps every chunk of a chunked session cookie and drops the stale unchunked copy", () => {
    const filtered = filterCandidateCookies({
      origin: ORIGIN,
      url: null,
      cookies: [
        { name: "__Secure-next-auth.session-token", value: "stale" },
        { name: "__Secure-next-auth.session-token.0", value: CHUNK_ZERO },
        { name: "__Secure-next-auth.session-token.1", value: CHUNK_ONE },
      ],
    }, contract);
    expect(filtered.ok).toBe(true);
    expect(filtered.cookies.map((cookie) => cookie.name)).toEqual([
      "__Secure-next-auth.session-token.0",
      "__Secure-next-auth.session-token.1",
    ]);
  });

  it("refuses an incomplete chunked session cookie", () => {
    const filtered = filterCandidateCookies({
      origin: ORIGIN,
      url: null,
      cookies: [{ name: "__Secure-next-auth.session-token.1", value: CHUNK_ONE }],
    }, contract);
    expect(filtered.ok).toBe(false);
    expect(filtered.error).toContain("incomplete");
  });

  it("refuses a request to another origin", () => {
    const parsed = parseCurlCommand(`curl 'https://auth.openai.com/authorize' -H 'Cookie: __Secure-next-auth.session-token=abc'`);
    expect(parsed.ok).toBe(true);
    const built = buildImportCandidates({ kind: "curl", parsed }, contract);
    expect(built.ok).toBe(false);
    expect(built.error).toContain("origin");
  });

  it("offers one candidate per matching HAR request and asks for a choice when they differ", () => {
    const parsed = parseHarDocument(JSON.stringify(HAR));
    const built = buildImportCandidates({ kind: "har", parsed }, contract);
    expect(built.ok).toBe(true);
    expect(built.candidates).toHaveLength(2);
    expect(candidatesAreAmbiguous(built.candidates)).toBe(true);
  });

  it("does not ask for a choice when every request carries the same credentials", () => {
    const same = {
      log: {
        entries: HAR.log.entries.slice(0, 2).map((entry) => ({
          request: { ...entry.request, headers: [{ name: "Cookie", value: `__Secure-next-auth.session-token.0=${CHUNK_ZERO}` }] },
        })),
      },
    };
    const built = buildImportCandidates({ kind: "har", parsed: parseHarDocument(JSON.stringify(same)) }, contract);
    expect(built.candidates).toHaveLength(2);
    expect(candidatesAreAmbiguous(built.candidates)).toBe(false);
  });

  it("refuses a HAR file without a request to the provider origin", () => {
    const other = { log: { entries: [HAR.log.entries[2]] } };
    const built = buildImportCandidates({ kind: "har", parsed: parseHarDocument(JSON.stringify(other)) }, contract);
    expect(built.ok).toBe(false);
  });
});

describe("dashboard cookie import", () => {
  let container;
  let root;
  let fetchMock;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith("/pairing")) {
        return {
          ok: true,
          status: 201,
          json: async () => ({
            pairing: {
              token: "ddpair_synthetic",
              header: "x-durindoor-pairing-token",
              expiresAt: "2030-01-01T00:00:00.000Z",
              importUrl: "https://dashboard.example/api/providers/cookie-import",
              contract: { origin: ORIGIN, cookieNames: ["__Secure-next-auth.session-token"], cookiePrefixes: ["__Secure-next-auth.session-token."] },
            },
          }),
        };
      }
      return {
        ok: true,
        status: 201,
        json: async () => ({ ok: true, action: "create", connection: { id: "c1", provider: "chatgpt-web", name: "Imported" } }),
      };
    });
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  const render = async (props = {}) => {
    await act(async () => {
      root.render(h(CookieImportModal, {
        isOpen: true,
        provider: "chatgpt-web",
        providerName: "ChatGPT Web",
        webLogin: WEB_LOGIN,
        connections: [],
        onSuccess: vi.fn(),
        onClose: vi.fn(),
        ...props,
      }));
    });
  };

  const fieldFor = (label) => Array.from(container.querySelectorAll("label")).find((node) => node.textContent.startsWith(label));
  const typeInto = async (label, value, tag = "input") => {
    const field = fieldFor(label);
    const control = field.querySelector(tag);
    await act(async () => {
      Object.getOwnPropertyDescriptor(tag === "textarea" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value").set.call(control, value);
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  const clickButton = async (text) => {
    const button = Array.from(container.querySelectorAll("button")).find((node) => node.textContent === text);
    await act(async () => { button.click(); });
  };
  const buttonFor = (text) => Array.from(container.querySelectorAll("button")).find((node) => node.textContent === text);
  const text = () => container.textContent;

  it("imports a pasted header through the authenticated import API", async () => {
    const onSuccess = vi.fn();
    await render({ onSuccess });
    await typeInto("Cookie header or cURL command", `__Secure-next-auth.session-token.0=${CHUNK_ZERO}; __Secure-next-auth.session-token.1=${CHUNK_ONE}`, "textarea");
    await clickButton("Read input");
    await typeInto("Connection name", "Imported");
    await clickButton("Import cookies");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [pairingUrl, pairingInit] = fetchMock.mock.calls[0];
    expect(pairingUrl).toBe("/api/providers/cookie-import/pairing");
    expect(JSON.parse(pairingInit.body)).toEqual({ provider: "chatgpt-web", action: "create", name: "Imported" });

    const [importUrl, importInit] = fetchMock.mock.calls[1];
    expect(importUrl).toBe("/api/providers/cookie-import");
    expect(importInit.headers["x-durindoor-pairing-token"]).toBe("ddpair_synthetic");
    const body = JSON.parse(importInit.body);
    expect(body.provider).toBe("chatgpt-web");
    expect(body.origin).toBe(ORIGIN);
    expect(body.cookies).toEqual([
      { name: "__Secure-next-auth.session-token.0", value: CHUNK_ZERO },
      { name: "__Secure-next-auth.session-token.1", value: CHUNK_ONE },
    ]);
    expect(onSuccess).toHaveBeenCalledWith(expect.objectContaining({ id: "c1" }));
  });

  it("never shows a cookie value in the status it reports", async () => {
    await render();
    await typeInto("Cookie header or cURL command", `__Secure-next-auth.session-token.0=${CHUNK_ZERO}`, "textarea");
    await clickButton("Read input");
    await typeInto("Connection name", "Imported");
    await clickButton("Import cookies");

    expect(text()).toContain("Imported 1 cookie into Imported.");
    expect(text()).not.toContain(CHUNK_ZERO);
  });

  it("clears the pasted input and the parsed cookies after a submission", async () => {
    await render();
    await typeInto("Cookie header or cURL command", `__Secure-next-auth.session-token.0=${CHUNK_ZERO}`, "textarea");
    await clickButton("Read input");
    await typeInto("Connection name", "Imported");
    await clickButton("Import cookies");

    expect(fieldFor("Cookie header or cURL command").querySelector("textarea").value).toBe("");
    expect(text()).not.toContain("__Secure-next-auth.session-token.0");
  });

  it("clears the pasted input when the operator dismisses the dialog", async () => {
    const onClose = vi.fn();
    await render({ onClose });
    await typeInto("Cookie header or cURL command", `__Secure-next-auth.session-token.0=${CHUNK_ZERO}`, "textarea");
    await clickButton("Read input");
    await clickButton("Cancel");

    expect(onClose).toHaveBeenCalled();
    expect(fieldFor("Cookie header or cURL command").querySelector("textarea").value).toBe("");
  });

  it("refuses a request to another origin and sends nothing", async () => {
    await render();
    await typeInto("Cookie header or cURL command", "curl 'https://auth.openai.com/authorize' -H 'Cookie: __Secure-next-auth.session-token=abc'", "textarea");
    await clickButton("Read input");

    expect(text()).toContain("The request origin is not approved for this provider.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(buttonFor("Import cookies").disabled).toBe(true);
  });

  it("asks which HAR request to import when the credentials differ", async () => {
    await render();
    await typeInto("Cookie header or cURL command", JSON.stringify(HAR), "textarea");
    await clickButton("Read input");

    expect(text()).toContain("Several requests in the input carry different credentials.");
    expect(buttonFor("Import cookies").disabled).toBe(true);

    const radios = Array.from(container.querySelectorAll("input[type=radio]"));
    expect(radios).toHaveLength(2);
    await act(async () => { radios[1].click(); });
    await typeInto("Connection name", "Imported");
    expect(buttonFor("Import cookies").disabled).toBe(false);
  });

  it("reads a local HAR file without uploading it", async () => {
    await render();
    await clickButton("HAR file");
    const fileInput = container.querySelector("input[type=file]");
    const file = { name: "session.har", size: 128, text: async () => JSON.stringify(HAR) };
    Object.defineProperty(fileInput, "files", { value: [file], configurable: true });
    await act(async () => {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(text()).toContain("Read session.har in this page. It is not uploaded.");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(text()).toContain("__Secure-next-auth.session-token.0");
  });

  it("creates an extension pairing in the dashboard", async () => {
    await render();
    await clickButton("Browser extension");
    await typeInto("Connection name", "Imported");
    await clickButton("Create pairing");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/providers/cookie-import/pairing");
    expect(text()).toContain("ddpair_synthetic");
    expect(text()).toContain("https://dashboard.example/api/providers/cookie-import");
  });

  // #2034: Inner.ai Web takes an optional account email that the server binds to the pairing.
  describe("optional account email", () => {
    const INNER_TOKEN = "synthetic-inner-token";
    const innerContract = resolveCookieImportContract({ origin: "https://app.innerai.com", cookieNames: ["token"], accountEmail: "optional" });
    const renderInner = (props = {}) => render({ provider: "inner-ai-web", providerName: "Inner.ai Web", webLogin: undefined, importContract: innerContract, ...props });
    const pasteInner = async () => {
      await typeInto("Cookie header or cURL command", `theme=dark; token=${INNER_TOKEN}`, "textarea");
      await clickButton("Read input");
      await typeInto("Connection name", "Inner");
    };

    it("is offered only for a contract that takes one, with the profile-lookup fallback explained", async () => {
      await render();
      expect(fieldFor("Account email")).toBeUndefined();
      await renderInner();
      expect(fieldFor("Account email (optional)").querySelector("input")).not.toBeNull();
      expect(text()).toContain("uses this one only when that lookup returns none");
      expect(text()).toContain("Leave it blank to store the token alone");
      expect(text()).toContain("The browser extension never reads an email");
    });

    it("sends a trimmed email with the pairing request only, never with the cookies", async () => {
      await renderInner();
      await pasteInner();
      await typeInto("Account email (optional)", "  user@example.com ");
      await clickButton("Import cookies");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: "inner-ai-web", action: "create", name: "Inner", accountEmail: "user@example.com" });
      const body = JSON.parse(fetchMock.mock.calls[1][1].body);
      expect(body).toEqual({ provider: "inner-ai-web", origin: "https://app.innerai.com", cookies: [{ name: "token", value: INNER_TOKEN }], name: "Inner" });
      expect(fieldFor("Account email (optional)").querySelector("input").value).toBe("");
    });

    it("omits a blank email so the token is stored alone", async () => {
      await renderInner();
      await pasteInner();
      await typeInto("Account email (optional)", "   ");
      await clickButton("Import cookies");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ provider: "inner-ai-web", action: "create", name: "Inner" });
    });

    it("blocks import and pairing on a malformed email and sends nothing", async () => {
      await renderInner();
      await pasteInner();
      await typeInto("Account email (optional)", "user@example.com\nX: 1");
      expect(text()).toContain("Enter a single email address, or leave the field blank.");
      expect(buttonFor("Import cookies").disabled).toBe(true);
      await clickButton("Browser extension");
      expect(buttonFor("Create pairing").disabled).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("binds the email when creating an extension pairing and never displays it in the pairing", async () => {
      await renderInner();
      await clickButton("Browser extension");
      await typeInto("Connection name", "Inner");
      await typeInto("Account email (optional)", "user@example.com");
      await clickButton("Create pairing");
      expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ provider: "inner-ai-web", accountEmail: "user@example.com" });
      expect(text()).toContain("ddpair_synthetic");
      // Editing the email after pairing drops the shown pairing, so a stale binding is never handed over.
      await typeInto("Account email (optional)", "other@example.com");
      expect(text()).not.toContain("ddpair_synthetic");
    });
  });

  it("does not offer the import for a provider without an importable contract", async () => {
    await render({ webLogin: { origin: "https://huggingface.co", cookieNames: "*" } });
    expect(container.querySelector("[data-testid=modal]")).toBe(null);
  });
});
