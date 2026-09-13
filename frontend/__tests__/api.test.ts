// ブラウザから BFF（/api/...）を呼ぶクライアント。test_spec.md にケース ID がないため test_extra_
import { api } from "@/lib/api";

let fetchMock: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  fetchMock = jest.spyOn(global, "fetch");
});

afterEach(() => {
  jest.restoreAllMocks();
});

const jsonResponse = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });

const call = (index = 0) => {
  const [url, init] = fetchMock.mock.calls[index];
  return { url: String(url), method: init?.method ?? "GET", headers: new Headers(init?.headers), body: init?.body };
};

describe("api", () => {
  it("test_extra_ 成功は kind=ok と本文", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { product_code: "1001", name: "醤油ラーメン", unit_price: 850 }));
    const result = await api.getProduct("1001");

    expect(call()).toMatchObject({ url: "/api/products/1001", method: "GET" });
    expect(result).toEqual({ kind: "ok", status: 200, data: { product_code: "1001", name: "醤油ラーメン", unit_price: 850 } });
  });

  it("test_extra_ エラーは kind=error とコード・details", async () => {
    const details = { server_totals: { subtotal: 2915, discount_total: 145, tax_amount: 277, total: 3047 } };
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { code: "TOTALS_MISMATCH", message: "x", details }));
    const result = await api.postTransaction({
      idempotency_key: "k", member_id: null, items: [{ product_code: "1001", quantity: 1 }],
      client_totals: { subtotal: 0, discount_total: 0, tax_amount: 0, total: 0 },
    });
    expect(result).toEqual({ kind: "error", status: 409, code: "TOTALS_MISMATCH", details });
  });

  it("test_extra_ 本文が JSON でないエラーはコードなし", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>Bad Gateway</html>", { status: 502 }));
    expect(await api.getSettings()).toEqual({ kind: "error", status: 502, code: null, details: undefined });
  });

  it("test_extra_ 通信できなければ kind=network", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    expect(await api.getSettings()).toEqual({ kind: "network" });
  });

  it("test_extra_ 会員IDはエンコードして送る", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { member_id: "M000001", name: "山田太郎" }));
    await api.getMember("M 1/2");
    expect(call().url).toBe("/api/members/M%201%2F2");
  });

  it("test_extra_ POST は JSON 本文と Content-Type を付ける", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { staff_id: "S001", name: "店主" }));
    await api.login("S001", "ramen-owner-2026");

    const { url, method, headers, body } = call();
    expect({ url, method }).toEqual({ url: "/api/auth/login", method: "POST" });
    expect(headers.get("content-type")).toBe("application/json");
    expect(JSON.parse(String(body))).toEqual({ staff_id: "S001", password: "ramen-owner-2026" });
  });

  it("test_extra_ 204 は本文なしの成功", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    expect(await api.logout()).toEqual({ kind: "ok", status: 204, data: null });
    expect(call()).toMatchObject({ url: "/api/auth/logout", method: "POST" });
  });

  it("test_extra_ 購入確定は本文をそのまま送る", async () => {
    const body = {
      idempotency_key: "3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f", member_id: "M000001",
      items: [{ product_code: "1001", quantity: 2 }],
      client_totals: { subtotal: 1700, discount_total: 0, tax_amount: 170, total: 1870 },
    };
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { transaction_id: 1, total: 1870 }));
    const result = await api.postTransaction(body);

    expect(call()).toMatchObject({ url: "/api/transactions", method: "POST" });
    expect(JSON.parse(String(call().body))).toEqual(body);
    expect(result).toMatchObject({ kind: "ok", status: 201 });
  });
});
