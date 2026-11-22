/**
 * Popup glue. All decisions live in capture.js; this file only moves text between
 * the form and that module. It writes with `textContent` and keeps nothing: the
 * pairing text and plan exist only in this closure and are cleared on every exit.
 */

import { prepareCapture, runCapture, describePlan, confirmationFor } from "./capture.js";

export function mountPopup(doc, { chrome, fetch, now = Date.now }) {
  const $ = (id) => doc.getElementById(id);
  const input = $("pairing");
  const stepInput = $("step-input");
  const stepReview = $("step-review");
  const confirm = $("confirm");
  const send = $("send");
  const status = $("status");
  let plan = null;
  let controller = null;

  const say = (message, isError = false) => {
    status.textContent = message;
    status.className = isError ? "error" : "";
  };
  const reset = () => {
    if (plan) plan.token = "";
    plan = null;
    controller = null;
    input.value = "";
    confirm.checked = false;
    confirm.disabled = false;
    send.disabled = true;
    stepReview.hidden = true;
    stepInput.hidden = false;
  };

  $("review").addEventListener("click", async () => {
    say("");
    const prepared = await prepareCapture({ chrome, text: input.value, now: now() });
    if (!prepared.ok) {
      say(prepared.expectedOrigin ? `${prepared.message} (${prepared.expectedOrigin})` : prepared.message, true);
      return;
    }
    plan = prepared.plan;
    input.value = "";
    const view = describePlan(plan);
    $("out-provider").textContent = view.label;
    $("out-origin").textContent = view.providerOrigin;
    $("out-dashboard").textContent = view.dashboardOrigin;
    $("out-target").textContent = view.action === "create" ? `New connection: ${view.target}` : `Replace cookies of connection ${view.target}`;
    // A localStorage item is shown with its storage, so it cannot be mistaken for a cookie name.
    $("out-cookies").textContent = [...view.cookieNames, ...view.localStorageKeys.map((key) => `localStorage ${key}`)].join(", ");
    const what = view.cookieNames.length ? "session cookies" : "session value";
    $("confirm-text").textContent = `I confirm: send my ${view.label} ${what} from ${view.providerOrigin} to ${view.dashboardOrigin}.`;
    confirm.checked = false;
    send.disabled = true;
    stepInput.hidden = true;
    stepReview.hidden = false;
  });

  confirm.addEventListener("change", () => { send.disabled = !confirm.checked || !plan; });

  send.addEventListener("click", async () => {
    if (!plan || !confirm.checked) return;
    const current = plan;
    controller = new AbortController();
    send.disabled = true;
    confirm.disabled = true;
    say("Waiting for permission, then sending once…");
    const result = await runCapture({
      chrome, fetch, plan: current, confirmed: confirmationFor(current), signal: controller.signal, now,
    });
    if (plan !== current) return;
    confirm.disabled = false;
    if (result.ok) {
      reset();
      const sent = result.cookieCount ? `${result.cookieCount} cookie(s)` : `${result.localStorageCount} session value(s)`;
      say(result.action === "create"
        ? `Created connection "${result.connection?.name ?? ""}" with ${sent}.`
        : `Updated the connection with ${sent}.`);
      return;
    }
    // A request that reached the dashboard spends the pairing; any other failure leaves it usable.
    const spent = ["network_error", "pairing_rejected", "rejected", "forbidden", "target_missing", "conflict", "server_error", "unexpected_status", "already_used", "pairing_expired"].includes(result.code);
    if (spent) reset(); else send.disabled = !confirm.checked;
    say(result.message, true);
  });

  $("cancel").addEventListener("click", () => {
    controller?.abort();
    reset();
    say("Cancelled. Nothing was sent.");
  });
}
