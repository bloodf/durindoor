import { handleCookieImport } from "@/lib/providers/cookieImport/handlers";

export const dynamic = "force-dynamic";
export async function POST(request) {
  return handleCookieImport(request);
}
