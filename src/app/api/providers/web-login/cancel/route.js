import { handleWebLogin } from "@/lib/webLoginRoutes";

export const dynamic = "force-dynamic";
export async function POST(request) {
  return handleWebLogin(request, "cancel");
}
