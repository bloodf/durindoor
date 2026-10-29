import { redirect } from "next/navigation";

export default function MonitoringPage() {
  redirect("/dashboard/usage");
}
