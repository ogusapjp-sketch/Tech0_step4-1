// BFF（design.md 2.1、5.1 BFF の共通処理、7.1、7.2）
// FastAPI への fetch を偽物に差し替えて、Route Handler を直接呼ぶ。test_spec.md にケース ID がないため test_extra_
import { NextRequest } from "next/server";

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { POST as refresh } from "@/app/api/auth/refresh/route";
import { GET as getMember } from "@/app/api/members/[memberId]/route";
import { GET as getProduct } from "@/app/api/products/[productCode]/route";
import { GET as getSettings } from "@/app/api/settings/route";
import { POST as postTransaction } from "@/app/api/transactions/route";

const BACKEND = "http://backend:8000";
const ACCESS = "access-token-old";
const REFRESH = "refresh-token-old";
const STAFF = JSON.stringify({ staff_id: "S001", name: "店主" });
const SESSION = { pos_access_token: ACCESS, pos_refresh_token: REFRESH, pos_staff: STAFF };

let fetchMock: jest.SpiedFunction<typeof fetch>;

beforeEach(() => {
  process.env.BACKEND_URL = BACKEND;
  process.env.APP_ENV = "development";
  fetchMock = jest.spyOn(global, "fetch");
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.APP_ENV;
});

const jsonResponse = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
  });

const bffRequest = (
  path: string,
  { method = "GET", cookies = {}, body, headers = {} }: {
    method?: string; cookies?: Record<string, string>; body?: string; headers?: Record<string, string>;
  } = {},
): NextRequest => {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  return new NextRequest(`http://localhost:3000${path}`, {
    method,
    body,
    headers: { ...(cookie ? { cookie } : {}), ...headers },
  });
};

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

const fetchCall = (index: number) => {
  const [url, init] = fetchMock.mock.calls[index];
  const headers = new Headers(init?.headers);
  return { url: String(url), method: init?.method, authorization: headers.get("authorization"), body: init?.body };
};

// Set-Cookie を「名前 → ヘッダ文字列」にする
const setCookies = (response: Response): Record<string, string> =>
  Object.fromEntries(response.headers.getSetCookie().map((c) => [c.split("=")[0], c]));

const cookieValue = (setCookie: string): string => decodeURIComponent(setCookie.split(";")[0].split("=").slice(1).join("="));

const TOKEN_EXPIRED = { code: "TOKEN_EXPIRED", message: "アクセストークンの有効期限が切れています" };
const TOKEN_INVALID = { code: "TOKEN_INVALID", message: "認証が必要です" };
const NEW_TOKENS = { access_token: "access-token-new", refresh_token: "refresh-token-new" };

describe("Cookie ↔ Authorization ヘッダの詰め替え", () => {
  it("test_extra_ Cookie のアクセストークンを Authorization: Bearer に載せて FastAPI へ中継する", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { product_code: "1001", name: "醤油ラーメン", unit_price: 850 }));
    const response = await getProduct(bffRequest("/api/products/1001", { cookies: SESSION }), params({ productCode: "1001" }));

    expect(fetchCall(0)).toMatchObject({ url: `${BACKEND}/products/1001`, method: "GET", authorization: `Bearer ${ACCESS}` });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ product_code: "1001", name: "醤油ラーメン", unit_price: 850 });
  });

  it("test_extra_ Cookie がなければ Authorization を付けず、FastAPI の 401 をそのまま返す（ST-30）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, TOKEN_INVALID));
    const response = await getSettings(bffRequest("/api/settings"));

    expect(fetchCall(0).authorization).toBeNull();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(TOKEN_INVALID);
  });

  it("test_extra_ ブラウザが送った Authorization ヘッダは中継しない（トークンは Cookie からだけ取る）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, TOKEN_INVALID));
    await getSettings(bffRequest("/api/settings", { headers: { authorization: "Bearer forged-token" } }));
    expect(fetchCall(0).authorization).toBeNull();
  });

  it("test_extra_ パスパラメータはエンコードして中継する", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(400, { code: "VALIDATION_ERROR", message: "入力値が不正です" }));
    const memberId = "M1; DROP TABLE member;--";
    const response = await getMember(bffRequest("/api/members/x", { cookies: SESSION }), params({ memberId }));

    expect(fetchCall(0).url).toBe(`${BACKEND}/members/M1%3B%20DROP%20TABLE%20member%3B--`);
    expect(response.status).toBe(400);
  });

  it("test_extra_ 購入確定は本文をそのまま中継し、201 と本文を返す", async () => {
    const body = JSON.stringify({ idempotency_key: "k", member_id: null, items: [], client_totals: {} });
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { transaction_id: 1 }));
    const response = await postTransaction(bffRequest("/api/transactions", { method: "POST", cookies: SESSION, body }));

    expect(fetchCall(0)).toMatchObject({ url: `${BACKEND}/transactions`, method: "POST", body, authorization: `Bearer ${ACCESS}` });
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("content-type")).toBe("application/json");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ transaction_id: 1 });
  });

  it("test_extra_ FastAPI に届かなければ 500 INTERNAL_ERROR（詳細は返さない）", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed: connect ECONNREFUSED"));
    const response = await getSettings(bffRequest("/api/settings", { cookies: SESSION }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: "INTERNAL_ERROR", message: "処理に失敗しました。もう一度お試しください" });
  });
});

describe("ログイン（API 1）", () => {
  const loginBody = JSON.stringify({ staff_id: "S001", password: "ramen-owner-2026" });
  const backendTokens = { access_token: "a", refresh_token: "r", staff_id: "S001", name: "店主" };

  it("test_extra_ トークンは Cookie に移し、本文は {staff_id, name} だけを返す（IT-01）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, backendTokens));
    const response = await login(bffRequest("/api/auth/login", { method: "POST", body: loginBody }));

    expect(fetchCall(0)).toMatchObject({ url: `${BACKEND}/auth/login`, method: "POST", body: loginBody, authorization: null });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ staff_id: "S001", name: "店主" });

    const cookies = setCookies(response);
    expect(Object.keys(cookies).sort()).toEqual(["pos_access_token", "pos_refresh_token", "pos_staff"]);
    expect(cookieValue(cookies.pos_access_token)).toBe("a");
    expect(cookieValue(cookies.pos_refresh_token)).toBe("r");
    expect(JSON.parse(cookieValue(cookies.pos_staff))).toEqual({ staff_id: "S001", name: "店主" });
    for (const setCookie of Object.values(cookies)) {
      expect(setCookie).toMatch(/;\s*HttpOnly/i);
      expect(setCookie).toMatch(/;\s*SameSite=Strict/i);
      expect(setCookie).toMatch(/;\s*Path=\//);
      expect(setCookie).toMatch(/;\s*Max-Age=43200/);
      // 開発（APP_ENV=development）では Secure を付けない（http://localhost のため）
      expect(setCookie).not.toMatch(/;\s*Secure/i);
    }
  });

  it.each([
    { label: "APP_ENV=production", appEnv: "production" },
    { label: "APP_ENV 未設定（本番扱い）", appEnv: undefined },
  ])("test_extra_ $label では Cookie に Secure を付ける", async ({ appEnv }) => {
    if (appEnv === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = appEnv;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, backendTokens));
    const response = await login(bffRequest("/api/auth/login", { method: "POST", body: loginBody }));

    for (const setCookie of Object.values(setCookies(response))) {
      expect(setCookie).toMatch(/;\s*Secure/i);
    }
  });

  it("test_extra_ ログイン失敗は FastAPI の応答をそのまま返し、Cookie を設定しない（IT-02）", async () => {
    const failed = { code: "AUTH_FAILED", message: "担当者IDまたはパスワードが正しくありません" };
    fetchMock.mockResolvedValueOnce(jsonResponse(401, failed));
    const response = await login(bffRequest("/api/auth/login", { method: "POST", body: loginBody }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(failed);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("test_extra_ ログインで FastAPI に届かなければ 500", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const response = await login(bffRequest("/api/auth/login", { method: "POST", body: loginBody }));
    expect(response.status).toBe(500);
  });
});

describe("期限切れ時の更新と再送（design.md 5.1）", () => {
  it("test_extra_ 401 TOKEN_EXPIRED なら refresh してから新しいアクセストークンで1回だけ再送し、Cookie を更新する（IT-05）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED))
      .mockResolvedValueOnce(jsonResponse(200, NEW_TOKENS))
      .mockResolvedValueOnce(jsonResponse(200, { product_code: "1001", name: "醤油ラーメン", unit_price: 850 }));
    const response = await getProduct(bffRequest("/api/products/1001", { cookies: SESSION }), params({ productCode: "1001" }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchCall(0)).toMatchObject({ url: `${BACKEND}/products/1001`, authorization: `Bearer ${ACCESS}` });
    expect(fetchCall(1)).toMatchObject({ url: `${BACKEND}/auth/refresh`, method: "POST", authorization: `Bearer ${REFRESH}` });
    expect(fetchCall(2)).toMatchObject({ url: `${BACKEND}/products/1001`, authorization: "Bearer access-token-new" });

    // ブラウザには 401 が届かない
    expect(response.status).toBe(200);
    const cookies = setCookies(response);
    expect(cookieValue(cookies.pos_access_token)).toBe("access-token-new");
    expect(cookieValue(cookies.pos_refresh_token)).toBe("refresh-token-new");
    expect(JSON.parse(cookieValue(cookies.pos_staff))).toEqual({ staff_id: "S001", name: "店主" });
    expect(cookies.pos_access_token).toMatch(/Max-Age=43200/);
  });

  it("test_extra_ 表示用 Cookie がないときは、トークンの Cookie だけを更新する", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED))
      .mockResolvedValueOnce(jsonResponse(200, NEW_TOKENS))
      .mockResolvedValueOnce(jsonResponse(200, { tax_rate_bp: 1000, campaigns: [] }));
    const cookies = { pos_access_token: ACCESS, pos_refresh_token: REFRESH };
    const response = await getSettings(bffRequest("/api/settings", { cookies }));

    expect(response.status).toBe(200);
    expect(Object.keys(setCookies(response)).sort()).toEqual(["pos_access_token", "pos_refresh_token"]);
  });

  it("test_extra_ 再送では同じ本文を送る（購入確定）", async () => {
    const body = JSON.stringify({ idempotency_key: "k" });
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED))
      .mockResolvedValueOnce(jsonResponse(200, NEW_TOKENS))
      .mockResolvedValueOnce(jsonResponse(201, { transaction_id: 1 }));
    const response = await postTransaction(bffRequest("/api/transactions", { method: "POST", cookies: SESSION, body }));

    expect(fetchCall(0).body).toBe(body);
    expect(fetchCall(2).body).toBe(body);
    expect(response.status).toBe(201);
  });

  it("test_extra_ 再送は1回だけ。再送も期限切れならそのまま返す", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED))
      .mockResolvedValueOnce(jsonResponse(200, NEW_TOKENS))
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED));
    const response = await getSettings(bffRequest("/api/settings", { cookies: SESSION }));

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(401);
  });

  it("test_extra_ TOKEN_INVALID（期限切れ以外）は更新せず、そのまま返す", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, TOKEN_INVALID));
    const response = await getSettings(bffRequest("/api/settings", { cookies: SESSION }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()).toEqual([]);
  });

  it("test_extra_ 本文が JSON でない 401 は更新せず、そのまま返す", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Unauthorized", { status: 401, headers: { "content-type": "text/plain" } }));
    const response = await getSettings(bffRequest("/api/settings", { cookies: SESSION }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("Unauthorized");
    expect(response.headers.get("content-type")).toBe("text/plain");
  });

  it("test_extra_ 401 以外のエラーは更新せず、そのまま返す", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { code: "PRODUCT_NOT_FOUND", message: "商品がマスタ未登録です" }));
    const response = await getProduct(bffRequest("/api/products/9999", { cookies: SESSION }), params({ productCode: "9999" }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ code: "PRODUCT_NOT_FOUND", message: "商品がマスタ未登録です" });
  });
});

describe("更新失敗時の Cookie 削除", () => {
  const expectAllCookiesCleared = (response: Response) => {
    const cookies = setCookies(response);
    expect(Object.keys(cookies).sort()).toEqual(["pos_access_token", "pos_refresh_token", "pos_staff"]);
    for (const setCookie of Object.values(cookies)) {
      expect(cookieValue(setCookie)).toBe("");
      expect(setCookie).toMatch(/Max-Age=0/);
      expect(setCookie).toMatch(/Path=\//);
    }
  };

  it("test_extra_ refresh が失敗したら再送せず、Cookie を3つとも削除して 401 TOKEN_INVALID（ログイン画面へ）", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED))
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_INVALID));
    const response = await getSettings(bffRequest("/api/settings", { cookies: SESSION }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual(TOKEN_INVALID);
    expectAllCookiesCleared(response);
  });

  it("test_extra_ 期限切れでリフレッシュトークンの Cookie もなければ、Cookie を削除して 401 TOKEN_INVALID", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED));
    const response = await getSettings(bffRequest("/api/settings", { cookies: { pos_access_token: ACCESS } }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(401);
    expectAllCookiesCleared(response);
  });

  it("test_extra_ /api/auth/refresh：成功なら Cookie を更新して本文なしの 200", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, NEW_TOKENS));
    const response = await refresh(bffRequest("/api/auth/refresh", { method: "POST", cookies: SESSION }));

    expect(fetchCall(0)).toMatchObject({ url: `${BACKEND}/auth/refresh`, authorization: `Bearer ${REFRESH}` });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(cookieValue(setCookies(response).pos_refresh_token)).toBe("refresh-token-new");
  });

  it("test_extra_ /api/auth/refresh：失敗なら Cookie を削除して 401 TOKEN_INVALID", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(401, TOKEN_INVALID));
    const response = await refresh(bffRequest("/api/auth/refresh", { method: "POST", cookies: SESSION }));

    expect(response.status).toBe(401);
    expectAllCookiesCleared(response);
  });

  it("test_extra_ /api/auth/refresh：リフレッシュトークンの Cookie がなければ FastAPI を呼ばずに 401", async () => {
    const response = await refresh(bffRequest("/api/auth/refresh", { method: "POST" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expectAllCookiesCleared(response);
  });

  it("test_extra_ /api/auth/refresh：FastAPI に届かなければ 500", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const response = await refresh(bffRequest("/api/auth/refresh", { method: "POST", cookies: SESSION }));
    expect(response.status).toBe(500);
  });
});

describe("ログアウト（API 3）", () => {
  it("test_extra_ アクセストークンをヘッダ、リフレッシュトークンを本文で渡し、Cookie を削除して 204（IT-06）", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(204));
    const response = await logout(bffRequest("/api/auth/logout", { method: "POST", cookies: SESSION }));

    expect(fetchCall(0)).toMatchObject({
      url: `${BACKEND}/auth/logout`, method: "POST", authorization: `Bearer ${ACCESS}`,
      body: JSON.stringify({ refresh_token: REFRESH }),
    });
    expect(response.status).toBe(204);
    const cookies = setCookies(response);
    expect(Object.keys(cookies).sort()).toEqual(["pos_access_token", "pos_refresh_token", "pos_staff"]);
    for (const setCookie of Object.values(cookies)) expect(setCookie).toMatch(/Max-Age=0/);
  });

  it("test_extra_ Cookie がなければ FastAPI を呼ばずに Cookie を削除して 204", async () => {
    const response = await logout(bffRequest("/api/auth/logout", { method: "POST" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(204);
    expect(response.headers.getSetCookie()).toHaveLength(3);
  });

  it("test_extra_ FastAPI がエラーを返しても Cookie は削除する", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_EXPIRED))
      .mockResolvedValueOnce(jsonResponse(401, TOKEN_INVALID));
    const response = await logout(bffRequest("/api/auth/logout", { method: "POST", cookies: SESSION }));

    expect(response.status).toBe(401);
    for (const setCookie of response.headers.getSetCookie()) expect(setCookie).toMatch(/Max-Age=0/);
  });
});

describe("設定", () => {
  it("test_extra_ BACKEND_URL が未設定なら 500", async () => {
    delete process.env.BACKEND_URL;
    const response = await getSettings(bffRequest("/api/settings", { cookies: SESSION }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(500);
  });

  it("test_extra_ BACKEND_URL の末尾のスラッシュは取り除く", async () => {
    process.env.BACKEND_URL = `${BACKEND}/`;
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { tax_rate_bp: 1000, campaigns: [] }));
    await getSettings(bffRequest("/api/settings", { cookies: SESSION }));
    expect(fetchCall(0).url).toBe(`${BACKEND}/settings`);
  });
});
