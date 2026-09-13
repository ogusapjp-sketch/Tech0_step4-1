/** @jest-environment jsdom */
// ログイン画面（FR-001、requirements.md 5.3 SR-001、design.md 6.2）。test_spec.md にケース ID がないため test_extra_
import { act, fireEvent, render, screen } from "@testing-library/react";

import { LoginForm } from "@/components/LoginForm";
import { api } from "@/lib/api";

import { fail, ok } from "./testSupport";

const mockReplace = jest.fn();
const mockRefresh = jest.fn();
jest.mock("next/navigation", () => ({ useRouter: () => ({ replace: mockReplace, refresh: mockRefresh }) }));
jest.mock("@/lib/api", () => ({ api: { login: jest.fn() } }));

const mockedApi = api as jest.Mocked<typeof api>;

beforeEach(() => {
  jest.clearAllMocks();
});

const submit = async (staffId: string, password: string) => {
  fireEvent.change(screen.getByLabelText("担当者ID"), { target: { value: staffId } });
  fireEvent.change(screen.getByLabelText("パスワード"), { target: { value: password } });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "ログイン" }));
  });
};

describe("LoginForm", () => {
  it("test_extra_ 成功するとレジ画面へ移す（ST-01）", async () => {
    mockedApi.login.mockResolvedValue(ok({ staff_id: "S001", name: "店主" }));
    render(<LoginForm />);
    await submit("S001", "ramen-owner-2026");

    expect(mockedApi.login).toHaveBeenCalledWith("S001", "ramen-owner-2026");
    expect(mockReplace).toHaveBeenCalledWith("/");
    expect(mockRefresh).toHaveBeenCalled();
  });

  it.each([
    { code: "AUTH_FAILED", status: 401, message: "担当者IDまたはパスワードが正しくありません" },
    { code: "AUTH_LOCKED", status: 423, message: "一定時間後に再試行してください" },
    { code: "INTERNAL_ERROR", status: 500, message: "処理に失敗しました。もう一度お試しください" },
  ])("test_extra_ $code →「$message」。レジ画面へ移さない（ST-02）", async ({ code, status, message }) => {
    mockedApi.login.mockResolvedValue(fail(status, code));
    render(<LoginForm />);
    await submit("S001", "wrong-password-0000");

    expect(screen.getByRole("alert")).toHaveTextContent(message);
    expect(mockReplace).not.toHaveBeenCalled();
    // 失敗したらパスワード欄を空にする
    expect(screen.getByLabelText("パスワード")).toHaveValue("");
  });

  it("test_extra_ 通信できなければ「通信できません」", async () => {
    mockedApi.login.mockResolvedValue({ kind: "network" });
    render(<LoginForm />);
    await submit("S001", "ramen-owner-2026");
    expect(screen.getByRole("alert")).toHaveTextContent("通信できません");
  });

  it.each([
    { label: "担当者IDに空白", staffId: "S 001", password: "ramen-owner-2026" },
    { label: "担当者IDが空", staffId: "", password: "ramen-owner-2026" },
    { label: "パスワード11文字", staffId: "S001", password: "a".repeat(11) },
    { label: "パスワード129文字", staffId: "S001", password: "a".repeat(129) },
  ])("test_extra_ $label は送信せずに入力形式を知らせる", async ({ staffId, password }) => {
    render(<LoginForm />);
    await submit(staffId, password);

    expect(mockedApi.login).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "担当者IDは英数字と - _ の20文字まで、パスワードは12〜128文字で入力してください",
    );
  });

  it("test_extra_ 400 VALIDATION_ERROR も入力形式を知らせる", async () => {
    mockedApi.login.mockResolvedValue(fail(400, "VALIDATION_ERROR"));
    render(<LoginForm />);
    await submit("S001", "ramen-owner-2026");
    expect(screen.getByRole("alert")).toHaveTextContent(
      "担当者IDは英数字と - _ の20文字まで、パスワードは12〜128文字で入力してください",
    );
  });
});
