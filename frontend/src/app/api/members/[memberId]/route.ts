// API 5：GET /api/members/{member_id}（design.md 5.2）。形式の検証は FastAPI が行う
import type { NextRequest, NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/server/bff";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
): Promise<NextResponse> {
  const { memberId } = await params;
  return proxyToBackend(request, { method: "GET", path: `/members/${encodeURIComponent(memberId)}` });
}
