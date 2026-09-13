// API 2：POST /api/auth/refresh（design.md 5.2）
// 通常は BFF の共通処理が内部で更新する。成功なら Cookie を更新して本文なし、失敗なら Cookie を削除して 401
import { NextResponse, type NextRequest } from "next/server";

import { applyRefreshedCookies, internalError, refreshTokens, tokenInvalid } from "@/lib/server/bff";
import { COOKIE } from "@/lib/server/cookies";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tokens = await refreshTokens(request.cookies.get(COOKIE.refreshToken)?.value);
    if (tokens === null) {
      return tokenInvalid();
    }
    const response = new NextResponse(null, { status: 200 });
    applyRefreshedCookies(response, tokens, request);
    return response;
  } catch (error) {
    return internalError(error);
  }
}
