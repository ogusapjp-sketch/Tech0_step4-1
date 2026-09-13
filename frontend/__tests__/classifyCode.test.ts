// test_spec.md 4.2.2 classifyCode — 会員ID／商品コードの判別（UT-F-10〜18）
// 期待値は test_spec.md の表の値をそのまま写す
import { classifyCode } from "@/lib/classifyCode";

describe("classifyCode", () => {
  it.each([
    { id: "UT-F-10", raw: "M000001", expected: "member" },
    { id: "UT-F-11", raw: "1001", expected: "product" },
    { id: "UT-F-12", raw: "m000001", expected: "invalid" },
    { id: "UT-F-13", raw: "M", expected: "invalid" },
    { id: "UT-F-14", raw: "", expected: "invalid" },
    { id: "UT-F-15", raw: "12M", expected: "invalid" },
    { id: "UT-F-16", raw: "M12a", expected: "invalid" },
    { id: "UT-F-17", raw: "１００１", expected: "invalid" },
    { id: "UT-F-18", raw: " 1001 ", expected: "product" },
  ])("$id $raw → $expected", ({ raw, expected }) => {
    expect(classifyCode(raw)).toBe(expected);
  });

  // 本書にケース ID のないテスト：長さ上限 20文字（test_spec.md 4.3）
  it.each([
    { raw: "1".repeat(20), expected: "product" },
    { raw: "1".repeat(21), expected: "invalid" },
    { raw: "M" + "1".repeat(19), expected: "member" },
    { raw: "M" + "1".repeat(20), expected: "invalid" },
    { raw: "  M000001\t", expected: "member" },
  ])("test_extra_ 長さと空白 $raw → $expected", ({ raw, expected }) => {
    expect(classifyCode(raw)).toBe(expected);
  });
});
