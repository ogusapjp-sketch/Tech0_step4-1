// API 6：GET /api/products/{product_code}（design.md 3.2.2、5.2）。形式の検証は FastAPI が行う
import type { NextRequest, NextResponse } from "next/server";

import { proxyToBackend } from "@/lib/server/bff";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ productCode: string }> },
): Promise<NextResponse> {
  const { productCode } = await params;
  return proxyToBackend(request, { method: "GET", path: `/products/${encodeURIComponent(productCode)}` });
}
