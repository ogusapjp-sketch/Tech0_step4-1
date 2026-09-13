// API 4：GET /api/settings（design.md 5.2）
import type { NextRequest, NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/server/bff";

export async function GET(request: NextRequest): Promise<NextResponse> {
  return proxyToBackend(request, { method: "GET", path: "/settings" });
}
