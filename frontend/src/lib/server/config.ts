// サーバ側（BFF・proxy）だけで使う設定。ブラウザには渡さない

// APP_ENV が未設定・空なら本番扱い（設定漏れで安全側に倒す。バックエンドと同じ判定）
export const isProduction = (): boolean => (process.env.APP_ENV || "production") === "production";

// FastAPI の内部アドレス（design.md 2.1）
export const backendUrl = (): string => {
  const url = process.env.BACKEND_URL;
  if (!url) {
    throw new Error("BACKEND_URL is required");
  }
  return url.replace(/\/+$/, "");
};
