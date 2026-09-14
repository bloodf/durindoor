import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ hooks: [], index: 0, effects: [], enabled: false, calls: [], pxpipeStatus: null }));

vi.mock("react", async () => {
  const actual = await vi.importActual("react");
  return {
    ...actual,
    useState(initial) {
      const index = state.index++;
      if (!(index in state.hooks)) state.hooks[index] = initial;
      return [state.hooks[index], (next) => {
        state.hooks[index] = typeof next === "function" ? next(state.hooks[index]) : next;
      }];
    },
    useRef(value) {
      const index = state.index++;
      if (!(index in state.hooks)) state.hooks[index] = { current: value };
      return state.hooks[index];
    },
    useEffect(effect) { state.effects.push(effect); },
    useCallback(callback) { return callback; },
  };
});
vi.mock("@/shared/ui/components/Toggle.jsx", () => ({ default: function Toggle() {} }));
vi.mock("@/shared/hooks/useCopyToClipboard", () => ({ useCopyToClipboard: () => ({ copied: false, copy: vi.fn() }) }));
vi.mock("@/i18n/runtime", () => ({ getCurrentLocale: () => "en", onLocaleChange: () => () => {} }));
vi.mock("../../src/app/(dashboard)/dashboard/token-saver/components/TokenSaverOverview.js", () => ({ default: function TokenSaverOverview() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/pxpipe/PxpipeClient.js", () => ({ default: function PxpipeClient() {} }));
vi.mock("../../src/app/(dashboard)/dashboard/pxpipe/pxpipeStatus.js", () => ({
  fetchPxpipeStatus: async () => state.pxpipeStatus ?? { installed: false, running: false }, getPxpipeStatusView: () => ({ label: "Unavailable" }),
}));

const { default: TokenSaverClient } = await import("@/app/(dashboard)/dashboard/token-saver/TokenSaverClient.jsx");
const { default: Toggle } = await import("@/shared/ui/components/Toggle.jsx");
const { Badge } = await import("@/shared/ui/components/Badge.jsx");

function response(body) { return { ok: true, json: async () => body }; }
function walk(element, predicate, result = []) {
  if (element == null || typeof element !== "object") return result;
  if (predicate(element)) result.push(element);
  const children = element.props?.children;
  for (const child of Array.isArray(children) ? children : [children]) walk(child, predicate, result);
  return result;
}
async function drainEffects() {
  while (state.effects.length) {
    const effects = state.effects.splice(0);
    for (const effect of effects) effect();
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
  }
}
async function renderWithProxyDown(enabled) {
  state.enabled = enabled;
  state.index = 0;
  state.hooks = [];
  state.effects = [];
  TokenSaverClient({ view: "settings" });
  await drainEffects();
  state.index = 0;
  return TokenSaverClient({ view: "settings" });
}
function headroomToggle(tree) {
  return walk(tree, (node) => node.type === Toggle && node.props["aria-label"] === "Enable Headroom")[0];
}
function minimumCharsInput(tree) {
  return walk(tree, (node) => node.props?.label === "Minimum chars")[0];
}

describe("Token Saver Headroom enabled setting", () => {
  beforeEach(() => {
    state.calls = [];
    state.pxpipeStatus = null;
    vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
      state.calls.push({ url, options });
      if (url === "/api/settings" && options.method === "PATCH") return response({ success: true });
      if (url === "/api/settings") return response({ headroomEnabled: state.enabled });
      if (url === "/api/headroom/status") return response({ installed: true, running: false, localUrl: true });
      if (url === "/api/headroom/extras") return response({ version: null, extras: {}, available: [] });
      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  it.each([[true, false], [false, true]])("uses persisted %s intent and PATCHes %s while proxy is stopped", async (enabled, next) => {
    const tree = await renderWithProxyDown(enabled);
    const toggle = headroomToggle(tree);
    expect(toggle.props.checked).toBe(enabled);
    expect(toggle.props.disabled).not.toBe(true);
    const stoppedBadge = walk(tree, (node) => node.type === Badge && node.props.children === "Stopped")[0];
    expect(stoppedBadge).toBeDefined();
    toggle.props.onChange(next);
    expect(state.calls.at(-1)).toMatchObject({
      url: "/api/settings",
      options: { method: "PATCH", body: JSON.stringify({ headroomEnabled: next, headroomUrl: "http://localhost:8787" }) },
    });
  });

  it("waits for saved settings before exposing editable default values", async () => {
    let resolveSettings;
    const savedSettings = new Promise((resolve) => { resolveSettings = resolve; });
    const fetchOther = globalThis.fetch.getMockImplementation();
    globalThis.fetch.mockImplementation((url, options = {}) =>
      url === "/api/settings" && !options.method ? savedSettings : fetchOther(url, options));
    state.index = 0;
    state.hooks = [];
    state.effects = [];
    const initial = TokenSaverClient({ view: "settings" });
    expect(minimumCharsInput(initial)).toBeUndefined();
    expect(walk(initial, (node) => node.props?.role === "status")).toHaveLength(1);
    await drainEffects();
    state.index = 0;
    expect(minimumCharsInput(TokenSaverClient({ view: "settings" }))).toBeUndefined();

    resolveSettings(response({ pxpipeMinChars: 31000 }));
    await drainEffects();
    state.index = 0;
    const loaded = TokenSaverClient({ view: "settings" });
    expect(minimumCharsInput(loaded).props.value).toBe("31000");
    minimumCharsInput(loaded).props.onChange({ target: { value: "31001" } });
    minimumCharsInput(loaded).props.onBlur({ currentTarget: { value: "31001" } });
    expect(state.calls.at(-1).options.body).toBe(JSON.stringify({ pxpipeMinChars: 31001 }));
  });

  it("preserves an edited minimum when a late status response arrives", async () => {
    let resolveStatus;
    state.pxpipeStatus = new Promise((resolve) => { resolveStatus = resolve; });
    const tree = await renderWithProxyDown(false);
    minimumCharsInput(tree).props.onChange({ target: { value: "25001" } });
    resolveStatus({ installed: true, running: true, minChars: 25000 });
    for (let i = 0; i < 4; i += 1) await Promise.resolve();
    state.index = 0;
    const edited = minimumCharsInput(TokenSaverClient({ view: "settings" }));
    expect(edited.props.value).toBe("25001");
    edited.props.onBlur({ currentTarget: { value: edited.props.value } });
    expect(state.calls.at(-1).options.body).toBe(JSON.stringify({ pxpipeMinChars: 25001 }));
  });

  it("does not expose editable defaults when loading saved settings fails", async () => {
    globalThis.fetch.mockResolvedValue({ ok: false, status: 500 });
    const tree = await renderWithProxyDown(false);
    expect(minimumCharsInput(tree)).toBeUndefined();
    expect(walk(tree, (node) => node.props?.role === "alert")).toHaveLength(1);
    expect(globalThis.fetch.mock.calls.some(([, options]) => options?.method === "PATCH")).toBe(false);
  });

  it("PATCHes the edited minimum chars when blur fires before a rerender", async () => {
    const tree = await renderWithProxyDown(false);
    const input = minimumCharsInput(tree);
    state.calls = [];

    input.props.onChange({ target: { value: "25001" } });
    input.props.onBlur({ currentTarget: { value: "25001" } });

    expect(state.calls).toContainEqual({
      url: "/api/settings",
      options: { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pxpipeMinChars: 25001 }) },
    });
  });
});
