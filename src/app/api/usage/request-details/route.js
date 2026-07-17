import { NextResponse } from "next/server";
import { getRequestDetails } from "@/lib/usageDb";

/**
 * GET /api/usage/request-details
 * Query parameters: page, pageSize (1-100), provider, model, connectionId, status, startDate, endDate
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    
    const rawPage = searchParams.get("page");
    const page = rawPage === null ? 1 : Number(rawPage);
    const rawPageSize = searchParams.get("pageSize");
    const pageSize = rawPageSize === null ? 20 : Number(rawPageSize);
    const provider = searchParams.get("provider");
    const model = searchParams.get("model");
    const connectionId = searchParams.get("connectionId");
    const status = searchParams.get("status");
    const startDate = searchParams.get("startDate");
    const endDate = searchParams.get("endDate");
    
    if (!Number.isInteger(page) || page < 1) {
      return NextResponse.json(
        { error: "page must be an integer >= 1" },
        { status: 400 }
      );
    }

    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json(
        { error: "pageSize must be an integer in [1,100]" },
        { status: 400 }
      );
    }
    
    const filter = {
      page,
      pageSize
    };
    
    if (provider) filter.provider = provider;
    if (model) filter.model = model;
    if (connectionId) filter.connectionId = connectionId;
    if (status) filter.status = status;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    const result = await getRequestDetails(filter);
    
    return NextResponse.json(result);
  } catch (error) {
    console.error("[API] Failed to get request details:", error);
    return NextResponse.json(
      { error: "Failed to fetch request details" },
      { status: 500 }
    );
  }
}
