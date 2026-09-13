// test_spec.md 4.2.1 calcTotals — バックエンド UT-B と同じ入力・同じ期待値
// 期待値は test_spec.md の表の値をそのまま写す（コード内で計算しない）
import { calcTotals, type CartLine } from "@/lib/pricing";

const MEMBER = "M000001";

// GET /settings が返す「本日有効な企画」をそのまま渡す。フロントは期間判定をしない
const C1 = { campaign_id: 1, name: "常連感謝トッピング企画", product_code: "2001", discount_type: "amount", discount_value: 20 } as const;
const C5 = { campaign_id: 5, name: "端数検証用", product_code: "1004", discount_type: "percent", discount_value: 10 } as const;
const C6 = { campaign_id: 6, name: "値引き上限検証用", product_code: "2002", discount_type: "amount", discount_value: 150 } as const;
// 表に企画の指定がないケース用（UT-B-28 と同じ入力）
const PERCENT_100_FOR_1001 = { campaign_id: 101, name: "テスト用", product_code: "1001", discount_type: "percent", discount_value: 100 } as const;

const line = (code: string, name: string, unitPrice: number, qty: number): CartLine => ({ code, name, unitPrice, qty });

describe("calcTotals", () => {
  it("UT-F-01 非会員・醤油850×2、税率1000 → (1700, 0, 170, 1870)", () => {
    const r = calcTotals([line("1001", "醤油ラーメン", 850, 2)], null, [], 1000);
    expect(r).toEqual({ subtotal: 1700, discountTotal: 0, taxAmount: 170, total: 1870 });
  });

  it("UT-F-02 会員・醤油850×2＋味玉120×3＋特製855×1、税率1000 → (2915, 145, 277, 3047)", () => {
    const items = [
      line("1001", "醤油ラーメン", 850, 2),
      line("2001", "味玉", 120, 3),
      line("1004", "特製ラーメン", 855, 1),
    ];
    const r = calcTotals(items, MEMBER, [C1, C5], 1000);
    expect(r).toEqual({ subtotal: 2915, discountTotal: 145, taxAmount: 277, total: 3047 });
  });

  it("UT-F-03 会員・味玉120×3（企画1）、税率1000 → (360, 60, 30, 330)", () => {
    const r = calcTotals([line("2001", "味玉", 120, 3)], MEMBER, [C1], 1000);
    expect(r).toEqual({ subtotal: 360, discountTotal: 60, taxAmount: 30, total: 330 });
  });

  it.each([
    { unitPrice: 5, expectedTax: 0 },
    { unitPrice: 999, expectedTax: 99 },
    { unitPrice: 1234, expectedTax: 123 },
  ])("UT-F-04 単価$unitPrice×1、税率1000 → 税額 $expectedTax", ({ unitPrice, expectedTax }) => {
    const r = calcTotals([line("9001", "テスト商品", unitPrice, 1)], null, [], 1000);
    expect(r.taxAmount).toBe(expectedTax);
  });

  it.each([
    { taxRateBp: 0, expectedTax: 0 },
    { taxRateBp: 100, expectedTax: 12 },
    { taxRateBp: 1200, expectedTax: 148 },
  ])("UT-F-05 単価1234×1、税率$taxRateBp → 税額 $expectedTax", ({ taxRateBp, expectedTax }) => {
    const r = calcTotals([line("9001", "テスト商品", 1234, 1)], null, [], taxRateBp);
    expect(r.taxAmount).toBe(expectedTax);
  });

  it("UT-F-06 99999×99、税率1000 → (9899901, 0, 989990, 10889891)", () => {
    const r = calcTotals([line("5002", "上限価格品", 99999, 99)], null, [], 1000);
    expect(r).toEqual({ subtotal: 9899901, discountTotal: 0, taxAmount: 989990, total: 10889891 });
  });

  it("UT-F-07 会員・850×1、percent 100 → (850, 850, 0, 0)", () => {
    const r = calcTotals([line("1001", "醤油ラーメン", 850, 1)], MEMBER, [PERCENT_100_FOR_1001], 1000);
    expect(r).toEqual({ subtotal: 850, discountTotal: 850, taxAmount: 0, total: 0 });
  });

  it("UT-F-08 会員・855×3、percent 10 → 値引き 255", () => {
    const r = calcTotals([line("1004", "特製ラーメン", 855, 3)], MEMBER, [C5], 1000);
    expect(r.discountTotal).toBe(255);
  });

  it("UT-F-09 会員・100×2、amount 150 → 値引き 200", () => {
    const r = calcTotals([line("2002", "のり", 100, 2)], MEMBER, [C6], 1000);
    expect(r.discountTotal).toBe(200);
  });
});
