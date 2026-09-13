// API 3：POST /api/auth/logout（design.md 5.2）
// Cookie のリフレッシュトークンを本文で FastAPI に渡して失効させ、Cookie を削除する
import { NextResponse, type NextRequest } from "next/server";

import { proxyToBackend } from "@/lib/server/bff";
import { COOKIE, clearAuthCookies } from "@/lib/server/cookies";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const refreshToken = request.cookies.get(COOKIE.refreshToken)?.value;
  const response = refreshToken
    ? await proxyToBackend(request, {
        method: "POST",
        path: "/auth/logout",
        body: JSON.stringify({ refresh_token: refreshToken }),
      })
    : new NextResponse(null, { status: 204 });
  // FastAPI での失効に失敗しても、この端末のセッションは必ず終わらせる
  clearAuthCookies(response);
  return response;
}
