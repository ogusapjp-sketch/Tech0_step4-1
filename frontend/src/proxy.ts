// Next.js 16 の proxy（旧 middleware）。ページのリクエストごとに動く
// - 未ログインでレジ画面を開いたらログイン画面へ移す（NFR-SEC-01）。トークンの有効性は API で FastAPI が確認する
// - リクエストごとの nonce で CSP を付ける（design.md 7.2。nonce 方式は人間が決定）
// - HSTS は本番だけ（人間が決定）
import { NextResponse, type NextRequest } from "next/server";

import { isProduction } from "@/lib/server/config";
import { COOKIE } from "@/lib/server/cookies";

const LOGIN_PATH = "/login";
const PROTECTED_PATHS = new Set(["/"]);
const HSTS = "max-age=31536000";

export const buildContentSecurityPolicy = (nonce: string, production: boolean): string => {
  const directives = [
    "default-src 'self'",
    // 開発時は React の開発用機能が eval を使う
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production ? "" : " 'unsafe-eval'"}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' data: blob:",
    "font-src 'self'",
    "connect-src 'self'",
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ];
  if (production) {
    directives.push("upgrade-insecure-requests");
  }
  return directives.join("; ");
};

const hasSession = (request: NextRequest): boolean =>
  request.cookies.has(COOKIE.accessToken) || request.cookies.has(COOKIE.refreshToken);

export function proxy(request: NextRequest): NextResponse {
  const production = isProduction();
  let response: NextResponse;

  if (PROTECTED_PATHS.has(request.nextUrl.pathname) && !hasSession(request)) {
    response = NextResponse.redirect(new URL(LOGIN_PATH, request.url));
  } else {
    const nonce = btoa(crypto.randomUUID());
    const contentSecurityPolicy = buildContentSecurityPolicy(nonce, production);
    // Next.js はリクエストの CSP ヘッダの script-src から nonce を読み取り、自分のスクリプトに付ける
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", contentSecurityPolicy);
    response = NextResponse.next({ request: { headers: requestHeaders } });
    response.headers.set("Content-Security-Policy", contentSecurityPolicy);
  }

  if (production) {
    response.headers.set("Strict-Transport-Security", HSTS);
  }
  return response;
}

// API（BFF）と静的ファイルは対象外
export const config = {
  matcher: [{ source: "/((?!api|_next/static|_next/image|favicon.ico).*)" }],
};
