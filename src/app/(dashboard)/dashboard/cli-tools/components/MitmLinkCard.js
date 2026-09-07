"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";

export default function MitmLinkCard({ tool }) {
  return (
    <Link href="/dashboard/mitm" className="block rounded-dd-lg focus-visible:shadow-dd-focus outline-none">
      <Card padding={false} className="cursor-pointer p-4 transition-colors hover:border-dd-accent/50">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-8 shrink-0 items-center justify-center">
              <Image
                src={tool.image}
                alt={tool.name}
                width={32}
                height={32}
                className="size-8 rounded-dd object-contain"
                sizes="32px"
                onError={(event) => { event.currentTarget.style.display = "none"; }}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <div className="flex items-center gap-2">
                <h3 className="truncate text-[13px] font-semibold text-dd-text">{tool.name}</h3>
                <Badge tone="info" size="sm">MITM</Badge>
              </div>
              <p className="truncate text-xs text-dd-muted">{tool.description}</p>
            </div>
          </div>
          <span className="material-symbols-outlined shrink-0 text-[20px] text-dd-muted" aria-hidden="true">chevron_right</span>
        </div>
      </Card>
    </Link>
  );
}
