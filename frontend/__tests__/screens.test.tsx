/** @jest-environment jsdom */
// test_spec.md 4.2.4 画面コンポーネント表示（UT-F-35〜41）
// 期待値（表示される文言・要素）は test_spec.md の表の値をそのまま写す
import { fireEvent, render, screen, within } from "@testing-library/react";

import { CartList } from "@/components/CartList";
import { RegisterScreen } from "@/components/RegisterScreen";
import { api } from "@/lib/api";

import { CAMPAIGNS, memberLookup, ok, productLookup } from "./testSupport";

jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: jest.fn(), refresh: jest.fn() }) }));
jest.mock("@/lib/api", () => ({
  api: { getSettings: jest.fn(), getMember: jest.fn(), getProduct: jest.fn(), postTransaction: jest.fn(), logout: jest.fn(), login: jest.fn() },
}));
// カメラは jsdom で使えないため、読み取った値を渡せる入力欄に置き換える
jest.mock("@/components/BarcodeScanner", () => ({
  BarcodeScanner: ({ onDetect }: { onDetect: (code: string) => void }) =>
    require("react").createElement("input", {
      "aria-label": "テスト用スキャン",
      onKeyDown: (e: { key: string; currentTarget: HTMLInputElement }) => {
        if (e.key === "Enter") onDetect(e.currentTarget.value);
      },
    }),
}));

const mockedApi = api as jest.Mocked<typeof api>;
const STAFF = { staff_id: "S001", name: "店主" };

beforeEach(() => {
  jest.clearAllMocks();
  mockedApi.getSettings.mockResolvedValue(ok({ tax_rate_bp: 1000, campaigns: CAMPAIGNS }));
  mockedApi.getProduct.mockImplementation(productLookup);
  mockedApi.getMember.mockImplementation(memberLookup);
});

const renderRegister = async () => {
  render(<RegisterScreen staff={STAFF} />);
  await screen.findByLabelText("税込合計");
};

const scan = async (code: string) => {
  const input = screen.getByLabelText("テスト用スキャン");
  fireEvent.change(input, { target: { value: code } });
  fireEvent.keyDown(input, { key: "Enter" });
};

describe("画面コンポーネント表示（UT-F-35〜41）", () => {
  it("UT-F-35 ログイン中 S001（店主）→「店主」が表示される", async () => {
    await renderRegister();
    expect(screen.getByText("店主")).toBeInTheDocument();
  });

  it("UT-F-36 商品照会が 404 →「商品がマスタ未登録です」", async () => {
    await renderRegister();
    fireEvent.change(screen.getByLabelText("商品コード"), { target: { value: "9999" } });
    fireEvent.click(screen.getByRole("button", { name: "照会" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("商品がマスタ未登録です");
  });

  it("UT-F-37 会員照会が 404 →「該当する会員が存在しません」", async () => {
    await renderRegister();
    fireEvent.change(screen.getByLabelText("会員ID"), { target: { value: "M999999" } });
    fireEvent.click(screen.getByRole("button", { name: "会員読込" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("該当する会員が存在しません");
  });

  it("UT-F-38 数量99で追加 →「上限に達しています」", async () => {
    await renderRegister();
    await scan("1001");
    fireEvent.click(await screen.findByRole("row", { name: /醤油ラーメン/ }));
    fireEvent.change(screen.getByLabelText("変更する数量"), { target: { value: "99" } });
    fireEvent.click(screen.getByRole("button", { name: "数量を変更" }));
    await scan("1001");
    expect(await screen.findByRole("alert")).toHaveTextContent("上限に達しています");
  });

  it("UT-F-39 味玉×3 に企画1 → 行に「−60」が表示される", () => {
    render(
      <CartList
        lines={[{ code: "2001", name: "味玉", unitPrice: 120, qty: 3 }]}
        memberId="M000001"
        campaigns={CAMPAIGNS}
        selectedCode={null}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("row", { name: /味玉/ })).toHaveTextContent("−60");
  });

  it("UT-F-40 会員未入力 → 会員欄が「会員なし」表示、値引きなし", async () => {
    await renderRegister();
    expect(screen.getByLabelText("会員情報")).toHaveTextContent("会員なし");
    await scan("2001");
    const row = await screen.findByRole("row", { name: /味玉/ });
    expect(row).not.toHaveTextContent("−");
  });

  it("UT-F-41 会員 M000001 を読込 → 画面に電話番号・住所が含まれない", async () => {
    // API が誤って電話番号・住所を返しても、画面には出さない
    mockedApi.getMember.mockResolvedValue(
      ok({ member_id: "M000001", name: "山田太郎", phone: "090-0000-0001", address: "東京都〇〇区" } as never),
    );
    await renderRegister();
    fireEvent.change(screen.getByLabelText("会員ID"), { target: { value: "M000001" } });
    fireEvent.click(screen.getByRole("button", { name: "会員読込" }));

    expect(await within(screen.getByLabelText("会員情報")).findByText(/山田太郎/)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("090-0000-0001");
    expect(document.body).not.toHaveTextContent("東京都〇〇区");
  });
});
