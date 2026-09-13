// 画面で使う純粋な関数。test_spec.md にケース ID がないため test_extra_
import { purchaseFingerprint, reuseOrCreateKey } from "@/lib/idempotencyKey";
import { CLIENT_MESSAGES, messageForError } from "@/lib/messages";
import { SCAN_COOLDOWN_MS, acceptScan } from "@/lib/scanCooldown";
import { parseStaffCookie } from "@/lib/staff";
import type { CartLine } from "@/lib/pricing";

describe("エラー文言（design.md 6.2）", () => {
  it.each([
    ["AUTH_FAILED", "担当者IDまたはパスワードが正しくありません"],
    ["AUTH_LOCKED", "一定時間後に再試行してください"],
    ["MEMBER_NOT_FOUND", "該当する会員が存在しません"],
    ["PRODUCT_NOT_FOUND", "商品がマスタ未登録です"],
    ["TOTALS_MISMATCH", "金額の再計算が必要です。画面を更新してください"],
    ["INTERNAL_ERROR", "処理に失敗しました。もう一度お試しください"],
  ])("test_extra_ %s → %s", (code, message) => {
    expect(messageForError(code)).toBe(message);
  });

  it.each([null, "UNKNOWN_CODE"])("test_extra_ 想定外のコード（%s）は INTERNAL_ERROR の文言", (code) => {
    expect(messageForError(code)).toBe("処理に失敗しました。もう一度お試しください");
  });

  it("test_extra_ 画面側の文言", () => {
    expect(CLIENT_MESSAGES.NETWORK).toBe("通信できません");
    expect(CLIENT_MESSAGES.QUANTITY_LIMIT).toBe("上限に達しています");
    expect(CLIENT_MESSAGES.ADDED).toBe("1件追加されました");
  });
});

describe("冪等キー（購入リストか会員が変わったら作り直す。人間が決定）", () => {
  const lines: CartLine[] = [{ code: "1001", name: "醤油ラーメン", unitPrice: 850, qty: 2 }];
  let counter = 0;
  const generate = () => `key-${++counter}`;

  beforeEach(() => {
    counter = 0;
  });

  it("test_extra_ 初回はキーを作る", () => {
    expect(reuseOrCreateKey(null, purchaseFingerprint("M000001", lines), generate).key).toBe("key-1");
  });

  it("test_extra_ 購入リストと会員が同じなら同じキーを使う（通信断からの再送）", () => {
    const first = reuseOrCreateKey(null, purchaseFingerprint("M000001", lines), generate);
    const second = reuseOrCreateKey(first, purchaseFingerprint("M000001", [...lines]), generate);
    expect(second.key).toBe("key-1");
  });

  it.each([
    { label: "数量", memberId: "M000001", changed: [{ ...lines[0], qty: 3 }] },
    { label: "商品", memberId: "M000001", changed: [...lines, { code: "2001", name: "味玉", unitPrice: 120, qty: 1 }] },
    { label: "会員", memberId: null, changed: lines },
  ])("test_extra_ $label が変わったら作り直す", ({ memberId, changed }) => {
    const first = reuseOrCreateKey(null, purchaseFingerprint("M000001", lines), generate);
    const second = reuseOrCreateKey(first, purchaseFingerprint(memberId, changed), generate);
    expect(second.key).toBe("key-2");
  });
});

describe("スキャンの重複防止", () => {
  it("test_extra_ 最初の読み取りは受け付ける", () => {
    expect(acceptScan(null, "1001", 1000)).toBe(true);
  });

  it("test_extra_ 同じコードは一定時間受け付けない（かざしている間に何件も追加しない）", () => {
    const last = { code: "1001", at: 1000 };
    expect(acceptScan(last, "1001", 1000 + SCAN_COOLDOWN_MS - 1)).toBe(false);
    expect(acceptScan(last, "1001", 1000 + SCAN_COOLDOWN_MS)).toBe(true);
  });

  it("test_extra_ 別のコードはすぐ受け付ける（連続スキャン）", () => {
    expect(acceptScan({ code: "1001", at: 1000 }, "2001", 1001)).toBe(true);
  });
});

describe("担当者の表示用 Cookie", () => {
  it("test_extra_ JSON を読み取る", () => {
    expect(parseStaffCookie(JSON.stringify({ staff_id: "S001", name: "店主" }))).toEqual({ staff_id: "S001", name: "店主" });
  });

  it.each([undefined, "", "not-json", JSON.stringify({ staff_id: "S001" }), JSON.stringify({ staff_id: 1, name: "店主" }), "null"])(
    "test_extra_ 不正な値（%s）は null",
    (raw) => {
      expect(parseStaffCookie(raw)).toBeNull();
    },
  );
});
