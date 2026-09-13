// 認証 Cookie（design.md 7.1）。名前・有効期間・属性は人間が承認済み
import type { NextResponse } from "next/server";

import { isProduction } from "@/lib/server/config";

export const COOKIE = {
  accessToken: "pos_access_token",
  refreshToken: "pos_refresh_token",
  // 担当者名の表示用（{staff_id, name} の JSON）。改ざんされても表示が変わるだけで認証には使わない
  staff: "pos_staff",
} as const;

// アクセストークンの Cookie も12時間残す。60分で消すと BFF がトークンなしで中継して TOKEN_INVALID になり、
// TOKEN_EXPIRED による自動更新（design.md 5.1）ができないため。トークン自体の期限は JWT の exp で判定される
const COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

export type TokenPair = { access_token: string; refresh_token: string };
export type StaffIdentity = { staff_id: string; name: string };

const cookieOptions = (maxAge: number) => ({
  httpOnly: true,
  sameSite: "strict" as const,
  path: "/",
  // http://localhost では Secure を付けると保存されないため、本番（APP_ENV 未設定を含む）でだけ付ける
  secure: isProduction(),
  maxAge,
});

export const setTokenCookies = (response: NextResponse, tokens: TokenPair): void => {
  response.cookies.set(COOKIE.accessToken, tokens.access_token, cookieOptions(COOKIE_MAX_AGE_SECONDS));
  response.cookies.set(COOKIE.refreshToken, tokens.refresh_token, cookieOptions(COOKIE_MAX_AGE_SECONDS));
};

export const serializeStaff = (staff: StaffIdentity): string =>
  JSON.stringify({ staff_id: staff.staff_id, name: staff.name });

export const setStaffCookie = (response: NextResponse, value: string): void => {
  response.cookies.set(COOKIE.staff, value, cookieOptions(COOKIE_MAX_AGE_SECONDS));
};

export const clearAuthCookies = (response: NextResponse): void => {
  for (const name of Object.values(COOKIE)) {
    response.cookies.set(name, "", cookieOptions(0));
  }
};
