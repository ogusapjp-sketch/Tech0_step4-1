import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "唯我独尊 レジ",
};

// nonce 方式の CSP（src/proxy.ts）はリクエストごとに nonce が変わるため、全ページを毎回サーバで描画する。
// 静的に生成したページには nonce が付かず、CSP でスクリプトが止められる
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
