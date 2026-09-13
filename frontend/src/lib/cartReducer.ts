// 購入リストの状態管理（test_spec.md 4.3、requirements.md 7章②）
// 失敗した操作は error 以外を変えず、成功した操作で error を null に戻す

import type { CartLine } from "@/lib/pricing";

// GET /api/products/{product_code} の応答（design.md 5.2 API 6）
export type Product = {
  product_code: string;
  name: string;
  unit_price: number;
};

export type CartError = "QUANTITY_LIMIT" | "LINE_LIMIT";

export type CartState = {
  lines: CartLine[];
  selectedCode: string | null;
  memberId: string | null;
  error: CartError | null;
};

export type CartAction =
  | { type: "ADD_PRODUCT"; product: Product }
  | { type: "SELECT_LINE"; code: string }
  | { type: "REMOVE_SELECTED" }
  | { type: "SET_QUANTITY"; qty: number }
  | { type: "SET_MEMBER"; memberId: string | null }
  | { type: "RESET" };

export const QUANTITY_MIN = 1;
export const QUANTITY_MAX = 99;
export const LINES_MAX = 50;

export const initialCartState: CartState = {
  lines: [],
  selectedCode: null,
  memberId: null,
  error: null,
};

const isValidQuantity = (qty: number): boolean =>
  Number.isInteger(qty) && qty >= QUANTITY_MIN && qty <= QUANTITY_MAX;

const addProduct = (state: CartState, product: Product): CartState => {
  const existing = state.lines.find((line) => line.code === product.product_code);
  if (existing) {
    // 失敗時は選択を維持する
    if (existing.qty >= QUANTITY_MAX) {
      return { ...state, error: "QUANTITY_LIMIT" };
    }
    return {
      ...state,
      lines: state.lines.map((line) => (line === existing ? { ...line, qty: line.qty + 1 } : line)),
      selectedCode: null,
      error: null,
    };
  }
  // 行数の上限は新しい商品にだけ適用する（既存商品の +1 は許可）
  if (state.lines.length >= LINES_MAX) {
    return { ...state, error: "LINE_LIMIT" };
  }
  const newLine: CartLine = {
    code: product.product_code,
    name: product.name,
    unitPrice: product.unit_price,
    qty: 1,
  };
  return { ...state, lines: [...state.lines, newLine], selectedCode: null, error: null };
};

export const cartReducer = (state: CartState, action: CartAction): CartState => {
  switch (action.type) {
    case "ADD_PRODUCT":
      return addProduct(state, action.product);

    case "SELECT_LINE":
      // 選択は排他。リストにない商品コードは何もしない
      if (!state.lines.some((line) => line.code === action.code)) {
        return state;
      }
      return { ...state, selectedCode: action.code, error: null };

    case "REMOVE_SELECTED":
      if (state.selectedCode === null) {
        return state;
      }
      return {
        ...state,
        lines: state.lines.filter((line) => line.code !== state.selectedCode),
        selectedCode: null,
        error: null,
      };

    case "SET_QUANTITY":
      // 1〜99 の整数のみ受理。未選択・範囲外は state を変えない。選択は維持
      if (state.selectedCode === null || !isValidQuantity(action.qty)) {
        return state;
      }
      return {
        ...state,
        lines: state.lines.map((line) =>
          line.code === state.selectedCode ? { ...line, qty: action.qty } : line,
        ),
        error: null,
      };

    case "SET_MEMBER":
      return { ...state, memberId: action.memberId, error: null };

    case "RESET":
      return initialCartState;
  }
};
