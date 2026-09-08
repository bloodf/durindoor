"use client";

import Button from "@/shared/ui/components/Button.jsx";
import { Card, CardContent } from "@/shared/ui/components/Card.jsx";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";

export default function TranslatorError({ reset }) {
  return (
    <main className="mx-auto w-full max-w-6xl space-y-4 p-4 text-[13px] sm:p-6 lg:p-8">
      <PageHeader icon="swap_horiz" title="Translator Debug" subtitle="Replay request flow — matches log files" />
      <Card padding={false}>
        <CardContent className="flex flex-col items-start gap-4 py-10">
          <span className="flex size-12 items-center justify-center rounded-dd-lg bg-dd-danger/10 text-dd-danger">
            <span aria-hidden="true" className="material-symbols-outlined text-[24px] leading-none">error</span>
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
