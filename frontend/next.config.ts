import type { NextConfig } from "next";

// 環境で変わらないセキュリティヘッダ。design.md 7.2 の2つと、人間が追加を決定した2つ
// 環境で変わる CSP（nonce）と HSTS（本番だけ）は src/proxy.ts で付ける
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Docker イメージ（段階8e）に必要なファイルだけを出力する
  output: "standalone",
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
