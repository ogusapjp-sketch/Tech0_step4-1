// 画面テストの共通データ。値は test_spec.md 3 のテストデータ
import type { ApiResult } from "@/lib/api";
import type { DiscountCampaign } from "@/lib/pricing";

export const ok = <T>(data: T, status = 200): ApiResult<T> => ({ kind: "ok", status, data });
export const fail = (status: number, code: string | null): ApiResult<never> => ({ kind: "error", status, code, details: undefined });

export const PRODUCTS: Record<string, { product_code: string; name: string; unit_price: number }> = {
  "1001": { product_code: "1001", name: "醤油ラーメン", unit_price: 850 },
  "1004": { product_code: "1004", name: "特製ラーメン", unit_price: 855 },
  "2001": { product_code: "2001", name: "味玉", unit_price: 120 },
};

// 基準日 9/5 に GET /settings が返す企画（企画1〜3・5）
export const CAMPAIGNS: DiscountCampaign[] = [
  { campaign_id: 1, name: "常連感謝トッピング企画", product_code: "2001", discount_type: "amount", discount_value: 20 },
  { campaign_id: 2, name: "常連感謝トッピング企画", product_code: "2002", discount_type: "amount", discount_value: 20 },
  { campaign_id: 3, name: "常連感謝トッピング企画", product_code: "2003", discount_type: "amount", discount_value: 20 },
  { campaign_id: 5, name: "端数検証用", product_code: "1004", discount_type: "percent", discount_value: 10 },
];

export const productLookup = async (code: string) =>
  PRODUCTS[code] ? ok(PRODUCTS[code]) : fail(404, "PRODUCT_NOT_FOUND");

export const memberLookup = async (memberId: string) =>
  memberId === "M000001" ? ok({ member_id: "M000001", name: "山田太郎" }) : fail(404, "MEMBER_NOT_FOUND");
