"use client";

import dynamic from "next/dynamic";

// The database settings page touches `document` while rendering, so it is
// mounted on the client only.
const DatabaseSettingsPage = dynamic(() => import("@/app/(dashboard)/dashboard/settings/database/page.js"), { ssr: false });

export default function Page() {
  return <DatabaseSettingsPage />;
}
