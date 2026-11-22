"use client";

import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import { useUiV5 } from "@/shared/ui/v5/production/uiVersion.js";
import MotionIcon from "@/shared/ui/v5/motion/MotionIcon.jsx";

export default function TranslatorError({ reset }) {
  const v5 = useUiV5();
  return (
    <main className={v5 ? "mx-auto w-full min-w-0 max-w-6xl space-y-4 p-4 text-[13px] text-dd-text sm:p-6 lg:p-8" : "mx-auto w-full max-w-6xl space-y-4 p-4 text-[13px] sm:p-6 lg:p-8"}>
      <PageHeader icon="swap_horiz" title="Translator Debug" subtitle="Replay request flow — matches log files" />
      <Card padding={false}>
        <CardContent
          role={v5 ? "alert" : undefined}
          className="flex flex-col items-start gap-4 py-10"
        >
          <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-danger/10 text-dd-danger">
            {v5 ? <MotionIcon name="error" size={24} /> : <span aria-hidden="true" className="material-symbols-outlined text-[24px] leading-none">error</span>}
          </span>
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-dd-text">Translator could not load</h2>
            <p className="max-w-md text-[13px] text-dd-muted">Request capture and conversion state remain unchanged. Retry this view to continue.</p>
          </div>
          <Button variant="primary" icon="refresh" onClick={reset}>Retry</Button>
        </CardContent>
      </Card>
    </main>
  );
}
