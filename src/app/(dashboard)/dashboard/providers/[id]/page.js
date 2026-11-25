"use client";

import { useParams } from "next/navigation";
import useProviderDetail from "./hooks/useProviderDetail.js";
import ProviderDetailSections from "./sections/ProviderDetailSections.jsx";

export default function ProviderDetailPage() {
  const { id } = useParams();
  return <ProviderDetail key={id} providerId={id} />;
}

function ProviderDetail({ providerId }) {
  const detail = useProviderDetail(providerId);
  return <ProviderDetailSections {...detail} />;
}
