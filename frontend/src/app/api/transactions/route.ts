// API 7：POST /api/transactions（design.md 3.2.3、5.2）。本文はそのまま中継し、再計算と照合は FastAPI が行う
import type { NextRequest, NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/server/bff";

export async function POST(request: NextRequest): Promise<NextResponse> {
  return proxyToBackend(request, { method: "POST", path: "/transactions", body: await request.text() });
}
