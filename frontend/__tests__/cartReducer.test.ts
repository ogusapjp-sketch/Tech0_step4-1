// test_spec.md 4.2.3 購入リストの状態管理（UT-F-19〜34）。state／action は test_spec.md 4.3
// 期待値は test_spec.md の表の値をそのまま写す
import { cartReducer, initialCartState, type CartState, type Product } from "@/lib/cartReducer";
import type { CartLine } from "@/lib/pricing";

const SHOYU: Product = { product_code: "1001", name: "醤油ラーメン", unit_price: 850 };
const AJITAMA: Product = { product_code: "2001", name: "味玉", unit_price: 120 };

const line = (product: Product, qty: number): CartLine => ({
  code: product.product_code,
  name: product.name,
  unitPrice: product.unit_price,
  qty,
});

const state = (overrides: Partial<CartState>): CartState => ({ ...initialCartState, ...overrides });

// 行数上限のケース用：互いに異なる商品を count 行
const distinctLines = (count: number): CartLine[] =>
  Array.from({ length: count }, (_, i) => line({ product_code: String(3000 + i), name: `商品${i}`, unit_price: 100 }, 1));

describe("cartReducer（UT-F-19〜34）", () => {
  it("UT-F-19 空リストに醤油を追加 → 1行、数量1", () => {
    const next = cartReducer(initialCartState, { type: "ADD_PRODUCT", product: SHOYU });
    expect(next.lines).toEqual([{ code: "1001", name: "醤油ラーメン", unitPrice: 850, qty: 1 }]);
  });

  it("UT-F-20 醤油をもう1回追加 → 1行のまま、数量2", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 1)] }), { type: "ADD_PRODUCT", product: SHOYU });
    expect(next.lines).toHaveLength(1);
    expect(next.lines[0].qty).toBe(2);
  });

  it("UT-F-21 味玉を追加 → 2行", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)] }), { type: "ADD_PRODUCT", product: AJITAMA });
    expect(next.lines).toHaveLength(2);
  });

  it("UT-F-22 数量99の行に追加 → 数量99のまま。上限フラグ ON", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 99)] }), { type: "ADD_PRODUCT", product: SHOYU });
    expect(next.lines[0].qty).toBe(99);
    expect(next.error).toBe("QUANTITY_LIMIT");
  });

  it("UT-F-23 1行目を選択 → 選択 = 1行目", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2), line(AJITAMA, 1)] }), { type: "SELECT_LINE", code: "1001" });
    expect(next.selectedCode).toBe("1001");
  });

  it("UT-F-24 2行目を選択 → 選択 = 2行目のみ", () => {
    const before = state({ lines: [line(SHOYU, 2), line(AJITAMA, 1)], selectedCode: "1001" });
    const next = cartReducer(before, { type: "SELECT_LINE", code: "2001" });
    expect(next.selectedCode).toBe("2001");
  });

  it("UT-F-25 選択行を削除 → 行が消える。選択 = なし", () => {
    const before = state({ lines: [line(SHOYU, 2), line(AJITAMA, 1)], selectedCode: "2001" });
    const next = cartReducer(before, { type: "REMOVE_SELECTED" });
    expect(next.lines.map((l) => l.code)).toEqual(["1001"]);
    expect(next.selectedCode).toBeNull();
  });

  it("UT-F-26 数量を 1 に変更 → 数量1", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)], selectedCode: "1001" }), { type: "SET_QUANTITY", qty: 1 });
    expect(next.lines[0].qty).toBe(1);
  });

  it("UT-F-27 数量を 0 に変更 → 拒否（数量変わらず）", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)], selectedCode: "1001" }), { type: "SET_QUANTITY", qty: 0 });
    expect(next.lines[0].qty).toBe(2);
  });

  it("UT-F-28 数量を 99 に変更 → 数量99", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)], selectedCode: "1001" }), { type: "SET_QUANTITY", qty: 99 });
    expect(next.lines[0].qty).toBe(99);
  });

  it("UT-F-29 数量を 100 に変更 → 拒否", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)], selectedCode: "1001" }), { type: "SET_QUANTITY", qty: 100 });
    expect(next.lines[0].qty).toBe(2);
  });

  it("UT-F-30 数量変更 → 選択維持", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)], selectedCode: "1001" }), { type: "SET_QUANTITY", qty: 3 });
    expect(next.selectedCode).toBe("1001");
  });

  it("UT-F-31 選択中に別商品を追加 → 選択解除", () => {
    const next = cartReducer(state({ lines: [line(SHOYU, 2)], selectedCode: "1001" }), { type: "ADD_PRODUCT", product: AJITAMA });
    expect(next.selectedCode).toBeNull();
  });

  it("UT-F-32 50種類目を追加 → 50行", () => {
    const next = cartReducer(state({ lines: distinctLines(49) }), { type: "ADD_PRODUCT", product: SHOYU });
    expect(next.lines).toHaveLength(50);
  });

  it("UT-F-33 51種類目を追加 → 拒否", () => {
    const next = cartReducer(state({ lines: distinctLines(50) }), { type: "ADD_PRODUCT", product: SHOYU });
    expect(next.lines).toHaveLength(50);
    expect(next.error).toBe("LINE_LIMIT");
  });

  it("UT-F-34 確定後のリセット → リスト空、会員 null、選択 null", () => {
    const before = state({ lines: [line(SHOYU, 2)], selectedCode: "1001", memberId: "M000001" });
    const next = cartReducer(before, { type: "RESET" });
    expect(next.lines).toEqual([]);
    expect(next.memberId).toBeNull();
    expect(next.selectedCode).toBeNull();
  });
});

// 本書にケース ID のないテスト（test_spec.md 4.3 の定義と、人間が決定した挙動）
describe("cartReducer（test_extra_）", () => {
  it("test_extra_ 50行のとき既存商品の +1 は許可", () => {
    const lines = [...distinctLines(49), line(SHOYU, 1)];
    const next = cartReducer(state({ lines }), { type: "ADD_PRODUCT", product: SHOYU });
    expect(next.lines).toHaveLength(50);
    expect(next.lines[49].qty).toBe(2);
    expect(next.error).toBeNull();
  });

  it("test_extra_ error は次に成功した操作で null に戻る", () => {
    const withError = state({ lines: [line(SHOYU, 99), line(AJITAMA, 1)], error: "QUANTITY_LIMIT" });
    expect(cartReducer(withError, { type: "ADD_PRODUCT", product: AJITAMA }).error).toBeNull();
    expect(cartReducer(withError, { type: "SELECT_LINE", code: "2001" }).error).toBeNull();
    expect(cartReducer(withError, { type: "SET_MEMBER", memberId: "M000001" }).error).toBeNull();
    expect(cartReducer({ ...withError, selectedCode: "2001" }, { type: "SET_QUANTITY", qty: 2 }).error).toBeNull();
    expect(cartReducer({ ...withError, selectedCode: "2001" }, { type: "REMOVE_SELECTED" }).error).toBeNull();
    expect(cartReducer(withError, { type: "RESET" }).error).toBeNull();
  });

  it("test_extra_ 失敗した操作は error を残し、state を変えない", () => {
    const withError = state({ lines: [line(SHOYU, 2)], selectedCode: "1001", error: "LINE_LIMIT" });
    expect(cartReducer(withError, { type: "SET_QUANTITY", qty: 0 })).toBe(withError);
  });

  it("test_extra_ 上限で追加に失敗しても選択は維持（人間が決定）", () => {
    const qtyLimit = state({ lines: [line(SHOYU, 99), line(AJITAMA, 1)], selectedCode: "2001" });
    expect(cartReducer(qtyLimit, { type: "ADD_PRODUCT", product: SHOYU }).selectedCode).toBe("2001");

    const lineLimit = state({ lines: distinctLines(50), selectedCode: "3000" });
    expect(cartReducer(lineLimit, { type: "ADD_PRODUCT", product: SHOYU }).selectedCode).toBe("3000");
  });

  it("test_extra_ 選択中の行をもう一度選んでも選択のまま（人間が決定）", () => {
    const before = state({ lines: [line(SHOYU, 2)], selectedCode: "1001" });
    expect(cartReducer(before, { type: "SELECT_LINE", code: "1001" }).selectedCode).toBe("1001");
  });

  it("test_extra_ リストにない商品コードの選択は何もしない（人間が決定）", () => {
    const before = state({ lines: [line(SHOYU, 2)], selectedCode: "1001" });
    expect(cartReducer(before, { type: "SELECT_LINE", code: "9999" })).toBe(before);
  });

  it("test_extra_ 未選択なら SET_QUANTITY は何もしない", () => {
    const before = state({ lines: [line(SHOYU, 2)] });
    expect(cartReducer(before, { type: "SET_QUANTITY", qty: 5 })).toBe(before);
  });

  it("test_extra_ 未選択なら REMOVE_SELECTED は何もしない", () => {
    const before = state({ lines: [line(SHOYU, 2)] });
    expect(cartReducer(before, { type: "REMOVE_SELECTED" })).toBe(before);
  });

  it("test_extra_ 整数でない数量は拒否", () => {
    const before = state({ lines: [line(SHOYU, 2)], selectedCode: "1001" });
    expect(cartReducer(before, { type: "SET_QUANTITY", qty: 1.5 })).toBe(before);
  });

  it("test_extra_ SET_MEMBER で会員の設定と会員なし（null）", () => {
    const withMember = cartReducer(initialCartState, { type: "SET_MEMBER", memberId: "M000001" });
    expect(withMember.memberId).toBe("M000001");
    expect(cartReducer(withMember, { type: "SET_MEMBER", memberId: null }).memberId).toBeNull();
  });

  it("test_extra_ 入力の state を書き換えない", () => {
    const before = Object.freeze(state({ lines: Object.freeze([Object.freeze(line(SHOYU, 2))]) as CartLine[], selectedCode: "1001" }));
    expect(() => cartReducer(before, { type: "ADD_PRODUCT", product: SHOYU })).not.toThrow();
    expect(() => cartReducer(before, { type: "SET_QUANTITY", qty: 5 })).not.toThrow();
    expect(() => cartReducer(before, { type: "REMOVE_SELECTED" })).not.toThrow();
    expect(before.lines[0].qty).toBe(2);
  });
});
