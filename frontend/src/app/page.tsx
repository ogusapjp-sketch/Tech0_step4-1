// レジ画面（requirements.md 5.3 SR-002）。未ログインなら src/proxy.ts がログイン画面へ移す
import { cookies } from "next/headers";

import { RegisterScreen } from "@/components/RegisterScreen";
import { COOKIE } from "@/lib/server/cookies";
import { parseStaffCookie } from "@/lib/staff";

export default async function RegisterPage() {
  // 担当者名は BFF がログイン時に設定した表示用 Cookie から、サーバで描画するときに読む（人間が決定）
  const cookieStore = await cookies();
  return <RegisterScreen staff={parseStaffCookie(cookieStore.get(COOKIE.staff)?.value)} />;
}
