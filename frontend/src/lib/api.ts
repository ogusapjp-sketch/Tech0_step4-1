// ブラウザから BFF（/api/...）を呼ぶクライアント（design.md 5.1・5.2）
// トークンは httpOnly Cookie にあり、JavaScript からは扱わない
import type { Product } from "@/lib/cartReducer";
import type { DiscountCampaign } from "@/lib/pricing";

export type ServerTotals = { subtotal: number; discount_total: number; tax_amount: number; total: number };
export type ErrorDetails = { server_totals?: ServerTotals; transaction_id?: number };

export type ApiResult<T> =
  | { kind: "ok"; status: number; data: T }
  | { kind: "error"; status: number; code: string | null; details: ErrorDetails | undefined }
  | { kind: "network" };

export type StaffIdentity = { staff_id: string; name: string };
export type Settings = { tax_rate_bp: number; campaigns: DiscountCampaign[] };
export type Member = { member_id: string; name: string };

export type TransactionRequestBody = {
  idempotency_key: string;
  member_id: string | null;
  items: { product_code: string; quantity: number }[];
  client_totals: ServerTotals;
};

export type TransactionResult = ServerTotals & {
  transaction_id: number;
  transacted_at: string;
  lines: {
    line_no: number;
    product_code: string;
    product_name: string;
    unit_price: number;
    quantity: number;
    discount_amount: number;
  }[];
};

const request = async <T>(path: string, options: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<ApiResult<T>> => {
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    return { kind: "network" };
  }

  if (response.ok) {
    const data = response.status === 204 ? null : await response.json();
    return { kind: "ok", status: response.status, data: data as T };
  }
  const body = (await response.json().catch(() => null)) as { code?: unknown; details?: ErrorDetails } | null;
  return {
    kind: "error",
    status: response.status,
    code: typeof body?.code === "string" ? body.code : null,
    details: body?.details,
  };
};

export const api = {
  login: (staffId: string, password: string) =>
    request<StaffIdentity>("/api/auth/login", { method: "POST", body: { staff_id: staffId, password } }),
  logout: () => request<null>("/api/auth/logout", { method: "POST" }),
  getSettings: () => request<Settings>("/api/settings"),
  getMember: (memberId: string) => request<Member>(`/api/members/${encodeURIComponent(memberId)}`),
  getProduct: (productCode: string) => request<Product>(`/api/products/${encodeURIComponent(productCode)}`),
  postTransaction: (body: TransactionRequestBody) =>
    request<TransactionResult>("/api/transactions", { method: "POST", body }),
};
