// API 1：POST /api/auth/login（design.md 3.2.1、5.2）
// FastAPI が本文で返すトークンを Cookie に移し、ブラウザには {staff_id, name} だけを返す
import { NextResponse, type NextRequest } from "next/server";

import { callBackend, internalError, relay } from "@/lib/server/bff";
import { serializeStaff, setStaffCookie, setTokenCookies } from "@/lib/server/cookies";

type LoginTokenResponse = {
  access_token: string;
  refresh_token: string;
  staff_id: string;
  name: string;
};

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const response = await callBackend({ method: "POST", path: "/auth/login", body: await request.text() });
    if (response.status !== 200) {
      return await relay(response);
    }
    const data = (await response.json()) as LoginTokenResponse;
    const result = NextResponse.json({ staff_id: data.staff_id, name: data.name });
    setTokenCookies(result, data);
    setStaffCookie(result, serializeStaff(data));
    return result;
  } catch (error) {
    return internalError(error);
  }
}
