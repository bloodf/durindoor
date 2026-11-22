"use client";

import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import TokenSaverDashboard from "@/shared/ui/v5/dashboards/TokenSaverDashboard.jsx";
import { TOKEN_SAVER_LAYOUT_KEY } from "@/shared/ui/v5/dashboards/model.js";
import TokenSaverClient from "./TokenSaverClient";

/** V5 monitoring dashboard; `view="settings"` always renders the incumbent settings. With V5 off this renders the incumbent unchanged. */
export default function TokenSaverRoute({ view = "overview" }) {
  const v5 = useUiV5();
  if (v5 && view !== "settings") {
    return <div className="mx-auto flex w-full max-w-7xl min-w-0 flex-col gap-6 p-4 sm:p-6"><TokenSaverDashboard persistLayout storageKey={TOKEN_SAVER_LAYOUT_KEY} savedNotice="Dashboard layout saved." /></div>;
  }
  return <TokenSaverClient view={view} v5={v5} />;
}
