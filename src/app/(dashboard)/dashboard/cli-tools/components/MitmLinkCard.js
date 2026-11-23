"use client";

import Link from "next/link";
import Image from "next/image";
import { Card } from "@/shared/ui/components/Card.jsx";
import { Badge } from "@/shared/ui/components/Badge.jsx";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";

export default function MitmLinkCard({ tool }) {
  const v5 = useUiV5();
  return (
    <Link href="/dashboard/mitm" className={v5 ? "block min-w-0 rounded-dd-lg outline-none focus-visible:shadow-dd-focus" : "block rounded-dd-lg focus-visible:shadow-dd-focus outline-none"}>
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
          {v5 ? <MotionIcon name="chevron_right" size={20} className="shrink-0 text-dd-muted" /> : <span className="material-symbols-outlined shrink-0 text-[20px] text-dd-muted" aria-hidden="true">chevron_right</span>}
        </div>
      </Card>
    </Link>
  );
}
