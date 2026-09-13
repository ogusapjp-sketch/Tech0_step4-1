// proxy.ts（ページの認証ガードと CSP）と next.config.ts のセキュリティヘッダ（design.md 7.2、NFR-SEC-01）
// CSP は nonce 方式、追加ヘッダ（Referrer-Policy、Permissions-Policy、HSTS は本番だけ）は人間が決定。test_extra_
import { NextRequest } from "next/server";

import nextConfig from "../next.config";
import { buildContentSecurityPolicy, config, proxy } from "@/proxy";

afterEach(() => {
  delete process.env.APP_ENV;
});

const pageRequest = (path: string, cookies: Record<string, string> = {}): NextRequest => {
  const cookie = Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
  return new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });
};

const nonceOf = (csp: string): string => /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";

describe("CSP（nonce 方式）", () => {
  it("test_extra_ 本番の CSP（APP_ENV 未設定も本番扱い）", () => {
    const csp = buildContentSecurityPolicy("abc123", true);
    expect(csp).toBe(
      "default-src 'self'; " +
        "script-src 'self' 'nonce-abc123' 'strict-dynamic'; " +
        "style-src 'self' 'nonce-abc123'; " +
        "img-src 'self' data: blob:; " +
        "font-src 'self'; " +
        "connect-src 'self'; " +
        "media-src 'self' blob:; " +
        "object-src 'none'; " +
        "base-uri 'self'; " +
        "form-action 'self'; " +
        "frame-ancestors 'none'; " +
        "upgrade-insecure-requests",
    );
  });

  it("test_extra_ 開発の CSP は unsafe-eval を足し、upgrade-insecure-requests を外す", () => {
    const csp = buildContentSecurityPolicy("abc123", false);
    expect(csp).toContain("script-src 'self' 'nonce-abc123' 'strict-dynamic' 'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("test_extra_ リクエストごとに nonce を作り、応答の CSP と Next.js に渡すリクエストヘッダの両方に入れる", () => {
    process.env.APP_ENV = "development";
    const first = proxy(pageRequest("/login"));
    const second = proxy(pageRequest("/login"));

    const csp = first.headers.get("content-security-policy") ?? "";
    const nonce = nonceOf(csp);
    expect(nonce).not.toBe("");
    expect(nonceOf(second.headers.get("content-security-policy") ?? "")).not.toBe(nonce);
    // NextResponse.next({ request: { headers } }) で上書きしたリクエストヘッダ
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
  });

  it.each([
    { label: "APP_ENV=production", appEnv: "production" },
    { label: "APP_ENV 未設定", appEnv: undefined },
  ])("test_extra_ $label では本番の CSP と HSTS を付ける", ({ appEnv }) => {
    if (appEnv !== undefined) process.env.APP_ENV = appEnv;
    const response = proxy(pageRequest("/login"));

    expect(response.headers.get("content-security-policy")).toContain("upgrade-insecure-requests");
    expect(response.headers.get("content-security-policy")).not.toContain("unsafe-eval");
    expect(response.headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("test_extra_ 開発では HSTS を付けない", () => {
    process.env.APP_ENV = "development";
    const response = proxy(pageRequest("/login"));
    expect(response.headers.get("strict-transport-security")).toBeNull();
  });
});

describe("ページの認証ガード（NFR-SEC-01）", () => {
  beforeEach(() => {
    process.env.APP_ENV = "development";
  });

  it("test_extra_ 未ログインでレジ画面を開くとログイン画面へ移す", () => {
    const response = proxy(pageRequest("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it.each<{ label: string; cookies: Record<string, string> }>([
    { label: "アクセストークン", cookies: { pos_access_token: "a" } },
    { label: "リフレッシュトークン", cookies: { pos_refresh_token: "r" } },
  ])("test_extra_ $label の Cookie があればレジ画面を表示する（有効性は API で確認）", ({ cookies }) => {
    const response = proxy(pageRequest("/", cookies));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-security-policy")).not.toBeNull();
  });

  it("test_extra_ ログイン画面は未ログインでも表示する", () => {
    const response = proxy(pageRequest("/login"));
    expect(response.headers.get("location")).toBeNull();
  });

  it("test_extra_ API と静的ファイルは proxy の対象外", () => {
    const [matcher] = config.matcher;
    const pattern = new RegExp(`^${matcher.source}$`);
    expect(pattern.test("/")).toBe(true);
    expect(pattern.test("/login")).toBe(true);
    expect(pattern.test("/api/settings")).toBe(false);
    expect(pattern.test("/_next/static/chunks/app.js")).toBe(false);
  });
});

describe("next.config.ts のセキュリティヘッダ", () => {
  it("test_extra_ すべてのパスに design.md 7.2 の2つと、追加の2つを付ける", async () => {
    const rules = await nextConfig.headers!();
    expect(rules).toEqual([
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
        ],
      },
    ]);
  });

  it("test_extra_ X-Powered-By を出さず、Docker 用に standalone で出力する", () => {
    expect(nextConfig.poweredByHeader).toBe(false);
    expect(nextConfig.output).toBe("standalone");
  });
});
