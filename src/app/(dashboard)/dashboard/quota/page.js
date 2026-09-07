import { Suspense } from "react";
import PageHeader from "@/shared/ui/components/PageHeader.jsx";
import ProviderLimits from "../usage/components/ProviderLimits";
import QuotaLoading from "./QuotaLoading";

export default function QuotaPage() {
  return <div className="space-y-4"><PageHeader icon="speed" title="Quota Tracker" subtitle="Provider limits and remaining capacity" /><Suspense fallback={<QuotaLoading />}><ProviderLimits /></Suspense></div>;
}
