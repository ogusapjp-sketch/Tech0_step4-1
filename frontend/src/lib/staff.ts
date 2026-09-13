// 担当者名の表示用 Cookie（pos_staff）の読み取り。表示にだけ使い、認証には使わない
import type { StaffIdentity } from "@/lib/api";

export const parseStaffCookie = (raw: string | undefined): StaffIdentity | null => {
  if (!raw) {
    return null;
  }
  try {
    const value = JSON.parse(raw) as { staff_id?: unknown; name?: unknown } | null;
    if (typeof value?.staff_id === "string" && typeof value.name === "string") {
      return { staff_id: value.staff_id, name: value.name };
    }
  } catch {
    // 壊れた値は表示しない
  }
  return null;
};
