import { handleWebLogin } from "@/lib/webLoginRoutes";

export const dynamic = "force-dynamic";
export async function GET(request) {
  return handleWebLogin(request, "status");
}
