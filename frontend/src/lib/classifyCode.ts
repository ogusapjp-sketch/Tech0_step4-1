// 読み取った値が会員ID か商品コードかを判別する（design.md 6.1 のコード体系）
// 手入力の前後の空白は trim してから判定する（test_spec.md 4.3）

export type CodeKind = "member" | "product" | "invalid";

// 大文字 M ＋数字、2〜20文字
const MEMBER_ID_PATTERN = /^M[0-9]{1,19}$/;
// 数字のみ、1〜20文字（[0-9] なので全角数字は含まない）
const PRODUCT_CODE_PATTERN = /^[0-9]{1,20}$/;

export const classifyCode = (raw: string): CodeKind => {
  const code = raw.trim();
  if (MEMBER_ID_PATTERN.test(code)) {
    return "member";
  }
  if (PRODUCT_CODE_PATTERN.test(code)) {
    return "product";
  }
  return "invalid";
};
