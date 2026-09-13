/** @jest-environment jsdom */
// レジ画面の操作（requirements.md 5.3 SR-002、design.md 3.1・6.2）。test_spec.md にケース ID がないため test_extra_
// 金額の期待値は ST-20・UT-B-19（2,915・145・277・3,047）
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

import { RegisterScreen } from "@/components/RegisterScreen";
import { api } from "@/lib/api";

import { CAMPAIGNS, fail, memberLookup, ok, productLookup } from "./testSupport";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }) }));
jest.mock("@/lib/api", () => ({
  api: { getSettings: jest.fn(), getMember: jest.fn(), getProduct: jest.fn(), postTransaction: jest.fn(), logout: jest.fn(), login: jest.fn() },
}));
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

let keyCounter = 0;
const generateKey = () => `key-${++keyCounter}`;

beforeEach(() => {
  jest.clearAllMocks();
  keyCounter = 0;
  mockedApi.getSettings.mockResolvedValue(ok({ tax_rate_bp: 1000, campaigns: CAMPAIGNS }));
  mockedApi.getProduct.mockImplementation(productLookup);
  mockedApi.getMember.mockImplementation(memberLookup);
  mockedApi.logout.mockResolvedValue(ok(null, 204));
});

const renderRegister = async () => {
  render(<RegisterScreen staff={STAFF} generateKey={generateKey} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "購入" })).toBeInTheDocument());
  await waitFor(() => expect(mockedApi.getSettings).toHaveBeenCalled());
  await act(async () => {});
};

const scan = async (code: string) => {
  const input = screen.getByLabelText("テスト用スキャン");
  fireEvent.change(input, { target: { value: code } });
  await act(async () => {
    fireEvent.keyDown(input, { key: "Enter" });
  });
};

const loadMember = async (memberId: string) => {
  fireEvent.change(screen.getByLabelText("会員ID"), { target: { value: memberId } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "会員読込" }));
  });
};

const rowOf = (name: RegExp) => screen.getByRole("row", { name });
const totals = () => screen.getByLabelText("合計");

// UT-B-19 の明細を登録する
const registerUtB19 = async () => {
  await scan("1001");
  await scan("1001");
  await scan("2001");
  await scan("2001");
  await scan("2001");
  await scan("1004");
};

describe("商品の登録", () => {
  it("test_extra_ スキャンは1段階で追加し「1件追加されました」を出す。同じ商品は数量を加算", async () => {
    await renderRegister();
    await scan("1001");
    expect(screen.getByRole("status")).toHaveTextContent("1件追加されました");
    expect(rowOf(/醤油ラーメン/)).toHaveTextContent("1");

    await scan("1001");
    expect(screen.getAllByRole("row")).toHaveLength(2); // 見出し行＋1行
    expect(within(rowOf(/醤油ラーメン/)).getByLabelText("数量")).toHaveTextContent("2");
  });

  it("test_extra_ 手入力は2段階（照会 → 名称・単価表示 → 追加）。前後の空白は取り除く", async () => {
    await renderRegister();
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("商品コード"), { target: { value: " 1001 " } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "照会" }));
    });
    expect(mockedApi.getProduct).toHaveBeenCalledWith("1001");
    expect(screen.getByLabelText("照会結果")).toHaveTextContent("醤油ラーメン");
    expect(screen.getByLabelText("照会結果")).toHaveTextContent("850円");
    expect(screen.queryByRole("row", { name: /醤油ラーメン/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "追加" }));
    expect(rowOf(/醤油ラーメン/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("1件追加されました");
    // 追加後は入力欄・名称・単価の表示をクリアする（FR-006）
    expect(screen.getByLabelText("商品コード")).toHaveValue("");
    expect(screen.queryByLabelText("照会結果")).toBeNull();
  });

  it("test_extra_ 照会後にコードを書き換えたら照会結果を消し、追加できなくする", async () => {
    await renderRegister();
    fireEvent.change(screen.getByLabelText("商品コード"), { target: { value: "1001" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "照会" }));
    });
    fireEvent.change(screen.getByLabelText("商品コード"), { target: { value: "1002" } });
    expect(screen.queryByLabelText("照会結果")).toBeNull();
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
  });

  it("test_extra_ 形式が不正な商品コードは照会せずに知らせる", async () => {
    await renderRegister();
    fireEvent.change(screen.getByLabelText("商品コード"), { target: { value: "abc" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "照会" }));
    });
    expect(mockedApi.getProduct).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("商品コードは数字（20桁まで）で入力してください");
  });

  it("test_extra_ 会員IDでも商品コードでもない読み取り値は知らせる", async () => {
    await renderRegister();
    await scan("m000001");
    expect(mockedApi.getProduct).not.toHaveBeenCalled();
    expect(mockedApi.getMember).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("読み取ったコードは会員IDでも商品コードでもありません");
  });

  it("test_extra_ スキャンした商品が未登録なら知らせ、購入リストは保持する（IT-27）", async () => {
    await renderRegister();
    await scan("1001");
    await scan("9999");
    expect(screen.getByRole("alert")).toHaveTextContent("商品がマスタ未登録です");
    expect(rowOf(/醤油ラーメン/)).toBeInTheDocument();
  });

  it("test_extra_ 通信できなければ「通信できません」", async () => {
    mockedApi.getProduct.mockResolvedValue({ kind: "network" });
    await renderRegister();
    await scan("1001");
    expect(screen.getByRole("alert")).toHaveTextContent("通信できません");
  });

  it("test_extra_ 正常な操作をすると前のエラー表示を消す", async () => {
    await renderRegister();
    await scan("9999");
    expect(screen.getByRole("alert")).toBeInTheDocument();
    await scan("1001");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("会員", () => {
  it("test_extra_ 会員証をスキャンすると会員名と「割引対象」を表示する（ST-03）", async () => {
    await renderRegister();
    await scan("M000001");
    expect(mockedApi.getMember).toHaveBeenCalledWith("M000001");
    expect(screen.getByLabelText("会員情報")).toHaveTextContent("山田太郎");
    expect(screen.getByLabelText("会員情報")).toHaveTextContent("割引対象");
  });

  it("test_extra_ 形式が不正な会員IDは照会せずに知らせる", async () => {
    await renderRegister();
    await loadMember("m000001");
    expect(mockedApi.getMember).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("会員IDは M と数字（20文字まで）で入力してください");
  });

  it("test_extra_ 商品の後に会員を読み込んでも値引きが付く（IT-22）。「会員なし」で外れる", async () => {
    await renderRegister();
    await scan("2001");
    expect(rowOf(/味玉/)).not.toHaveTextContent("−");

    await loadMember(" M000001 ");
    expect(mockedApi.getMember).toHaveBeenCalledWith("M000001");
    expect(rowOf(/味玉/)).toHaveTextContent("−20");

    fireEvent.click(screen.getByRole("button", { name: "会員なし" }));
    expect(screen.getByLabelText("会員情報")).toHaveTextContent("会員なし");
    expect(screen.getByLabelText("会員ID")).toHaveValue("");
    expect(rowOf(/味玉/)).not.toHaveTextContent("−");
  });
});

describe("購入リストの編集と合計", () => {
  it("test_extra_ 行を選ぶと強調表示し、名称・単価・数量を表示する。削除で行が消える", async () => {
    await renderRegister();
    await scan("1001");
    await scan("2001");

    fireEvent.click(rowOf(/味玉/));
    expect(rowOf(/味玉/)).toHaveAttribute("aria-selected", "true");
    expect(rowOf(/醤油ラーメン/)).toHaveAttribute("aria-selected", "false");
    const panel = screen.getByLabelText("選択中の商品");
    expect(panel).toHaveTextContent("味玉");
    expect(panel).toHaveTextContent("120円");
    expect(screen.getByLabelText("変更する数量")).toHaveValue(1);

    fireEvent.click(screen.getByRole("button", { name: "削除" }));
    expect(screen.queryByRole("row", { name: /味玉/ })).toBeNull();
    expect(screen.getByLabelText("選択中の商品")).toHaveTextContent("商品を選択してください");
  });

  it("test_extra_ 数量は1〜99。範囲外は知らせて変えない", async () => {
    await renderRegister();
    await scan("1001");
    fireEvent.click(rowOf(/醤油ラーメン/));

    fireEvent.change(screen.getByLabelText("変更する数量"), { target: { value: "100" } });
    fireEvent.click(screen.getByRole("button", { name: "数量を変更" }));
    expect(screen.getByRole("alert")).toHaveTextContent("数量は1〜99で入力してください");
    expect(within(rowOf(/醤油ラーメン/)).getByLabelText("数量")).toHaveTextContent("1");

    fireEvent.change(screen.getByLabelText("変更する数量"), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "数量を変更" }));
    expect(within(rowOf(/醤油ラーメン/)).getByLabelText("数量")).toHaveTextContent("5");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("test_extra_ 税抜・値引き・税込を表示する（ST-20：2,915・145・3,047）", async () => {
    await renderRegister();
    await loadMember("M000001");
    await registerUtB19();

    expect(within(totals()).getByLabelText("税抜合計")).toHaveTextContent("2,915円");
    expect(within(totals()).getByLabelText("値引き合計")).toHaveTextContent("145円");
    expect(within(totals()).getByLabelText("消費税")).toHaveTextContent("277円");
    expect(within(totals()).getByLabelText("税込合計")).toHaveTextContent("3,047円");
  });
});

describe("購入確定", () => {
  it("test_extra_ 購入リストが空なら購入できない（IT-25）", async () => {
    await renderRegister();
    expect(screen.getByRole("button", { name: "購入" })).toBeDisabled();
  });

  it("test_extra_ 確定するとポップアップに税込合計。閉じると画面をクリアする（ST-21・ST-23）", async () => {
    mockedApi.postTransaction.mockResolvedValue(ok({ transaction_id: 1, total: 3047 } as never, 201));
    await renderRegister();
    await loadMember("M000001");
    await registerUtB19();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(mockedApi.postTransaction).toHaveBeenCalledWith({
      idempotency_key: "key-1",
      member_id: "M000001",
      items: [
        { product_code: "1001", quantity: 2 },
        { product_code: "2001", quantity: 3 },
        { product_code: "1004", quantity: 1 },
      ],
      client_totals: { subtotal: 2915, discount_total: 145, tax_amount: 277, total: 3047 },
    });
    const dialog = screen.getByRole("dialog", { name: "購入完了" });
    expect(dialog).toHaveTextContent("3,047円");

    fireEvent.click(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("row")).toHaveLength(1);
    expect(screen.getByLabelText("会員情報")).toHaveTextContent("会員なし");
    expect(screen.getByLabelText("会員ID")).toHaveValue("");
  });

  it("test_extra_ 通信できなければリストを保持し、再度の購入では同じ冪等キーを使う（UAT-13）", async () => {
    mockedApi.postTransaction
      .mockResolvedValueOnce({ kind: "network" })
      .mockResolvedValueOnce(ok({ transaction_id: 1, total: 935 } as never, 201));
    await renderRegister();
    await scan("1001");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("通信できません");
    expect(rowOf(/醤油ラーメン/)).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(mockedApi.postTransaction.mock.calls[1][0].idempotency_key).toBe("key-1");
    expect(screen.getByRole("dialog", { name: "購入完了" })).toBeInTheDocument();
  });

  it("test_extra_ 500（DB のタイムアウトなど）は文言を出してリストを保持し、再度の購入は同じ冪等キーで確定する（IT-34）", async () => {
    mockedApi.postTransaction
      .mockResolvedValueOnce(fail(500, "INTERNAL_ERROR"))
      .mockResolvedValueOnce(ok({ transaction_id: 1, total: 935 } as never, 201));
    await renderRegister();
    await scan("1001");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("処理に失敗しました。もう一度お試しください");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowOf(/醤油ラーメン/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "購入" })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(mockedApi.postTransaction.mock.calls.map((c) => c[0].idempotency_key)).toEqual(["key-1", "key-1"]);
    expect(screen.getByRole("dialog", { name: "購入完了" })).toHaveTextContent("935円");
  });

  it("test_extra_ 失敗の後に購入リストを変えたら、新しい冪等キーを作る", async () => {
    mockedApi.postTransaction.mockResolvedValue({ kind: "network" });
    await renderRegister();
    await scan("1001");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    await scan("2001");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(mockedApi.postTransaction.mock.calls.map((c) => c[0].idempotency_key)).toEqual(["key-1", "key-2"]);
  });

  it("test_extra_ DUPLICATE は完了扱い（エラー表示しない）で、画面の税込合計を表示する", async () => {
    mockedApi.postTransaction.mockResolvedValue(fail(409, "DUPLICATE"));
    await renderRegister();
    await scan("1001");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("dialog", { name: "購入完了" })).toHaveTextContent("935円");
  });

  it("test_extra_ TOTALS_MISMATCH は確定せずに知らせる", async () => {
    mockedApi.postTransaction.mockResolvedValue(fail(409, "TOTALS_MISMATCH"));
    await renderRegister();
    await scan("1001");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("金額の再計算が必要です。画面を更新してください");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rowOf(/醤油ラーメン/)).toBeInTheDocument();
  });

  it("test_extra_ 購入の入力エラー（400）は知らせる", async () => {
    mockedApi.postTransaction.mockResolvedValue(fail(400, "VALIDATION_ERROR"));
    await renderRegister();
    await scan("1001");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("購入内容に誤りがあります。画面を更新してください");
  });
});

describe("認証と設定", () => {
  it.each([
    { label: "商品照会", run: () => scan("1001"), mock: () => mockedApi.getProduct.mockResolvedValue(fail(401, "TOKEN_INVALID")) },
    { label: "会員照会", run: () => loadMember("M000001"), mock: () => mockedApi.getMember.mockResolvedValue(fail(401, "TOKEN_INVALID")) },
  ])("test_extra_ $label が 401 ならログイン画面へ移す", async ({ run, mock }) => {
    mock();
    await renderRegister();
    await run();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("test_extra_ 購入が 401 ならログイン画面へ移す", async () => {
    mockedApi.postTransaction.mockResolvedValue(fail(401, "TOKEN_INVALID"));
    await renderRegister();
    await scan("1001");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "購入" }));
    });
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("test_extra_ 設定が 401 ならログイン画面へ移す", async () => {
    mockedApi.getSettings.mockResolvedValue(fail(401, "TOKEN_INVALID"));
    render(<RegisterScreen staff={STAFF} generateKey={generateKey} />);
    await waitFor(() => expect(mockReplace).toHaveBeenCalledWith("/login"));
  });

  it("test_extra_ 設定を取得できなければ知らせ、購入できない", async () => {
    mockedApi.getSettings.mockResolvedValue({ kind: "network" });
    render(<RegisterScreen staff={STAFF} generateKey={generateKey} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("通信できません");
    await scan("1001");
    expect(screen.getByRole("button", { name: "購入" })).toBeDisabled();
  });

  it("test_extra_ 設定取得が 500 なら処理失敗の文言", async () => {
    mockedApi.getSettings.mockResolvedValue(fail(500, "INTERNAL_ERROR"));
    render(<RegisterScreen staff={STAFF} generateKey={generateKey} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("処理に失敗しました。もう一度お試しください");
  });

  it("test_extra_ ログアウトするとログイン画面へ移す", async () => {
    await renderRegister();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ログアウト" }));
    });
    expect(mockedApi.logout).toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith("/login");
  });

  it("test_extra_ 担当者の Cookie が読めなければ担当者名の代わりに「—」", async () => {
    render(<RegisterScreen staff={null} generateKey={generateKey} />);
    await act(async () => {});
    expect(screen.getByLabelText("担当者")).toHaveTextContent("—");
  });

  it("test_extra_ トーストはしばらくすると消える", async () => {
    jest.useFakeTimers();
    try {
      await renderRegister();
      await scan("1001");
      expect(screen.getByRole("status")).toHaveTextContent("1件追加されました");
      await act(async () => {
        jest.advanceTimersByTime(2000);
      });
      expect(screen.queryByRole("status")).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
