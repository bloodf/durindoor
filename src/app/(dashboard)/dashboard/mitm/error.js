"use client";

import { useEffect } from "react";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";

export default function MitmError({ error, reset }) {
  const v5 = useUiV5();
  useEffect(() => {
    console.error("MITM page error:", error);
  }, [error]);

  return <div className={v5 ? "v5-dashboard-page flex min-w-0 items-center justify-center py-20 text-dd-text" : "flex items-center justify-center py-20"}><EmptyState icon="warning" title="Something went wrong" message="The MITM page failed to load. This may happen during hydration in production builds." action={{ label: "Try again", icon: "refresh", onClick: reset }} /></div>;
}
