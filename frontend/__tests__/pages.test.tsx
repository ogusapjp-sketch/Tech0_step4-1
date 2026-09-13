/** @jest-environment jsdom */
// App Router のページ（requirements.md 5.3：ログイン画面とレジ画面の2画面）。test_spec.md にケース ID がないため test_extra_
import { render, screen } from "@testing-library/react";

import RootLayout, { dynamic, metadata } from "@/app/layout";
import LoginPage from "@/app/login/page";
import RegisterPage from "@/app/page";

const mockCookieGet = jest.fn();
jest.mock("next/headers", () => ({ cookies: async () => ({ get: mockCookieGet }) }));
jest.mock("@/components/RegisterScreen", () => ({
  RegisterScreen: ({ staff }: { staff: unknown }) =>
    require("react").createElement("p", null, `register:${JSON.stringify(staff)}`),
}));
jest.mock("@/components/LoginForm", () => ({
  LoginForm: () => require("react").createElement("p", null, "login-form"),
}));

describe("ページ", () => {
  it("test_extra_ レジ画面は表示用 Cookie の担当者を RegisterScreen に渡す", async () => {
    mockCookieGet.mockReturnValue({ value: JSON.stringify({ staff_id: "S001", name: "店主" }) });
    render(await RegisterPage());
    expect(mockCookieGet).toHaveBeenCalledWith("pos_staff");
    expect(screen.getByText('register:{"staff_id":"S001","name":"店主"}')).toBeInTheDocument();
  });

  it("test_extra_ 表示用 Cookie がなければ担当者は null", async () => {
    mockCookieGet.mockReturnValue(undefined);
    render(await RegisterPage());
    expect(screen.getByText("register:null")).toBeInTheDocument();
  });

  it("test_extra_ ログイン画面は LoginForm を表示する", () => {
    render(<LoginPage />);
    expect(screen.getByText("login-form")).toBeInTheDocument();
  });

  it("test_extra_ レイアウトは日本語。nonce の CSP のため全ページを毎回サーバで描画する", () => {
    const element = RootLayout({ children: "child" });
    expect(element.props.lang).toBe("ja");
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.title).toBe("唯我独尊 レジ");
  });
});
