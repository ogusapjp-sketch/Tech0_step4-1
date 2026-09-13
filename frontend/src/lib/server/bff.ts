// BFF の共通処理（design.md 5.1）
// - Cookie のアクセストークンを Authorization: Bearer に載せて FastAPI へ中継する
// - FastAPI が 401 TOKEN_EXPIRED を返したら、リフレッシュトークンで更新して1回だけ再送する
// - 更新にも失敗したら Cookie を削除し、401 TOKEN_INVALID でログイン画面への遷移を指示する
// - FastAPI の応答はそのまま返す。業務ロジックは持たない
import { NextResponse, type NextRequest } from "next/server";

import { backendUrl } from "@/lib/server/config";
import {
  COOKIE,
  clearAuthCookies,
  setStaffCookie,
  setTokenCookies,
  type TokenPair,
} from "@/lib/server/cookies";

export type BackendCall = {
  method: "GET" | "POST";
  path: string;
  body?: string;
};

const TOKEN_INVALID = { code: "TOKEN_INVALID", message: "認証が必要です" };
const INTERNAL_ERROR = { code: "INTERNAL_ERROR", message: "処理に失敗しました。もう一度お試しください" };

export const callBackend = (call: BackendCall, bearerToken?: string): Promise<Response> => {
  // ブラウザから届いたヘッダは中継せず、Cookie から取り出したトークンだけを載せる
  const headers = new Headers();
  if (bearerToken) {
    headers.set("Authorization", `Bearer ${bearerToken}`);
  }
  if (call.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  return fetch(`${backendUrl()}${call.path}`, {
    method: call.method,
    headers,
    body: call.body,
    cache: "no-store",
  });
};

// FastAPI の応答（ステータス・本文・Content-Type）をそのままブラウザへ返す
export const relay = async (response: Response): Promise<NextResponse> => {
  const body = response.status === 204 ? null : await response.text();
  const relayed = new NextResponse(body, { status: response.status });
  const contentType = response.headers.get("content-type");
  if (body !== null && contentType) {
    relayed.headers.set("content-type", contentType);
  }
  return relayed;
};

export const internalError = (error: unknown): NextResponse => {
  // 詳細はサーバのログにだけ残す
  console.error("BFF: request to backend failed", error);
  return NextResponse.json(INTERNAL_ERROR, { status: 500 });
};

export const tokenInvalid = (): NextResponse => {
  const response = NextResponse.json(TOKEN_INVALID, { status: 401 });
  clearAuthCookies(response);
  return response;
};

const isTokenExpired = async (response: Response): Promise<boolean> => {
  if (response.status !== 401) {
    return false;
  }
  const body: unknown = await response.clone().json().catch(() => null);
  return (body as { code?: unknown } | null)?.code === "TOKEN_EXPIRED";
};

export const refreshTokens = async (refreshToken: string | undefined): Promise<TokenPair | null> => {
  if (!refreshToken) {
    return null;
  }
  const response = await callBackend({ method: "POST", path: "/auth/refresh" }, refreshToken);
  if (response.status !== 200) {
    return null;
  }
  return (await response.json()) as TokenPair;
};

export const applyRefreshedCookies = (response: NextResponse, tokens: TokenPair, request: NextRequest): void => {
  setTokenCookies(response, tokens);
  // 表示用 Cookie も同じ有効期間に延ばす
  const staff = request.cookies.get(COOKIE.staff)?.value;
  if (staff) {
    setStaffCookie(response, staff);
  }
};

export const proxyToBackend = async (request: NextRequest, call: BackendCall): Promise<NextResponse> => {
  try {
    const first = await callBackend(call, request.cookies.get(COOKIE.accessToken)?.value);
    if (!(await isTokenExpired(first))) {
      return await relay(first);
    }

    const tokens = await refreshTokens(request.cookies.get(COOKIE.refreshToken)?.value);
    if (tokens === null) {
      return tokenInvalid();
    }
    // 再送は1回だけ。再送の結果はそのまま返す
    const response = await relay(await callBackend(call, tokens.access_token));
    applyRefreshedCookies(response, tokens, request);
    return response;
  } catch (error) {
    return internalError(error);
  }
};
