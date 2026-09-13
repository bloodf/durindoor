"use client";

import dynamic from "next/dynamic";

// The playground restores chat history from localStorage during its first
// render, so server HTML never matches once a visitor has chatted. Mount it on
// the client only.
const PlaygroundPageClient = dynamic(() => import("@/app/(dashboard)/dashboard/playground/PlaygroundPageClient"), { ssr: false });

export default function PlaygroundPage() {
  return <PlaygroundPageClient />;
}
