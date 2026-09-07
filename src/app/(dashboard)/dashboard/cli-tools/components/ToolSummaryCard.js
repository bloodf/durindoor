"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

function getStatusTone(tool, status) {
  if (tool.unsupported) return "danger";
  if (!status) return "neutral";
  if (!status.installed) return "neutral";
  if (status.has9Router) return "success";
  return "warning";
}

function getStatusLabel(tool, status) {
  if (tool.unsupported) return "Unsupported";
  if (!status) return "Unknown";
  if (!status.installed) return "Not installed";
  if (status.has9Router) return "Connected";
  return "Not configured";
}

export default function ToolSummaryCard({ toolId, tool, status }) {
  const tone = getStatusTone(tool, status);
  const label = getStatusLabel(tool, status);
  return (
    <Link href={`/dashboard/cli-tools/${toolId}`} className="block rounded-dd-lg focus-visible:shadow-dd-focus outline-none">
      <Card padding={false} className="h-full cursor-pointer p-4 transition-colors hover:border-dd-accent/50">
        <div className="flex h-full items-center gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-dd bg-dd-surface-2 text-dd-muted">
            {tool.image ? (
              <Image src={tool.image} alt={tool.name} width={32} height={32} className="size-8 rounded-dd object-contain" sizes="32px" onError={(event) => { event.currentTarget.style.display = "none"; }} />
            ) : tool.icon ? (
              <span className="material-symbols-outlined text-[24px] leading-none" aria-hidden="true">{tool.icon}</span>
            ) : null}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <h3 className="truncate text-[13px] font-semibold text-dd-text">{tool.name}</h3>
            <Badge tone={tone} size="sm">{label}</Badge>
          </div>
          <span className="material-symbols-outlined shrink-0 text-[20px] text-dd-muted" aria-hidden="true">chevron_right</span>
        </div>
      </Card>
    </Link>
  );
}
