import { notFound } from "next/navigation";
import { CLI_TOOLS } from "@/shared/constants/cliTools";
import ToolDetailClient from "@/app/(dashboard)/dashboard/cli-tools/[toolId]/ToolDetailClient";
import { MACHINE_ID } from "@site/mock/fixtures/world.js";

export default async function ToolDetailPage({ params }) {
  const { toolId } = await params;
  if (!CLI_TOOLS[toolId]) notFound();
  return <ToolDetailClient toolId={toolId} machineId={MACHINE_ID} />;
}
