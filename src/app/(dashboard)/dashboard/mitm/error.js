"use client";

import { useEffect } from "react";
import EmptyState from "@/shared/ui/components/EmptyState.jsx";
export default function MitmError({ error, reset }) {
  useEffect(() => {
    console.error("MITM page error:", error);
  }, [error]);

  return <div className="flex items-center justify-center py-20"><EmptyState icon="warning" title="Something went wrong" message="The MITM page failed to load. This may happen during hydration in production builds." action={{ label: "Try again", icon: "refresh", onClick: reset }} /></div>;
}
