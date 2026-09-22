// 画面で使う純粋な関数。test_spec.md にケース ID がないため test_extra_
import { purchaseFingerprint, reuseOrCreateKey } from "@/lib/idempotencyKey";
import { CLIENT_MESSAGES, messageForError } from "@/lib/messages";
import { SCAN_RELEASE_FRAMES, SCAN_RELEASE_MS, createScanGate } from "@/lib/scanGate";
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

describe("スキャンの重複防止（一度離すまで同じコードを受け付けない。design.md 6.4）", () => {
  // 読み取りは 200ms ごと。「離した」と判断するには、1.0秒以上たち、かつ連続5フレーム検出されないことが必要
  const frames = (gate: ReturnType<typeof createScanGate>, from: number, count: number, codes: string[] = []) => {
    for (let i = 1; i <= count; i += 1) {
      gate.accept(codes, from + i * 200);
    }
    return from + count * 200;
  };

  it("test_extra_ 最初の読み取りは受け付ける", () => {
    expect(createScanGate().accept(["1001"], 1000)).toEqual(["1001"]);
  });

  it("test_extra_ かざしたままの間は、何フレーム続いても受け付けない", () => {
    const gate = createScanGate();
    expect(gate.accept(["1001"], 0)).toEqual(["1001"]);
    for (let at = 200; at <= 6000; at += 200) {
      expect(gate.accept(["1001"], at)).toEqual([]);
    }
  });

  it("test_extra_ 1.0秒以上たち、かつ連続5フレーム検出されなければ受け付ける", () => {
    const gate = createScanGate();
    gate.accept(["1001"], 0);
    const at = frames(gate, 0, SCAN_RELEASE_FRAMES); // 200〜1000ms の5フレームは何も読めない
    expect(at).toBe(SCAN_RELEASE_MS);
    expect(gate.accept(["1001"], at + 200)).toEqual(["1001"]);
  });

  it("test_extra_ 時間がたっていても、検出されなかったフレームが5回に満たなければ受け付けない", () => {
    // 読み取りが途切れがちでも、解除されないことの確認（フレーム数の条件）
    const gate = createScanGate();
    gate.accept(["1001"], 0);
    frames(gate, 0, SCAN_RELEASE_FRAMES - 1); // 空フレームは4回だけ
    expect(gate.accept(["1001"], 100000)).toEqual([]);
  });

  it("test_extra_ フレーム数が足りていても、1.0秒たっていなければ受け付けない", () => {
    // 読み取りが速い（フレーム間隔が短い）場合に、すぐ解除されないことの確認（時間の条件）
    const gate = createScanGate(SCAN_RELEASE_MS, SCAN_RELEASE_FRAMES);
    gate.accept(["1001"], 0);
    for (let i = 1; i <= 10; i += 1) {
      gate.accept([], i * 50); // 50ms ごとに10フレーム（合計 500ms）
    }
    expect(gate.accept(["1001"], 550)).toEqual([]);
  });

  it("test_extra_ 途中で一度でも検出されたら、時間もフレーム数も数え直す", () => {
    const gate = createScanGate();
    gate.accept(["1001"], 0);
    frames(gate, 0, 4); // 空フレーム4回（800ms）
    gate.accept(["1001"], 1000); // 手ぶれなどで再び見えた → 数え直し
    frames(gate, 1000, 4); // 空フレーム4回（1800ms まで）
    expect(gate.accept(["1001"], 2000)).toEqual([]); // 5回目に満たないので受け付けない
    frames(gate, 2000, SCAN_RELEASE_FRAMES);
    expect(gate.accept(["1001"], 3200)).toEqual(["1001"]);
  });

  it("test_extra_ 別のコードはすぐ受け付ける（連続スキャン）", () => {
    const gate = createScanGate();
    expect(gate.accept(["1001"], 0)).toEqual(["1001"]);
    expect(gate.accept(["2001"], 200)).toEqual(["2001"]);
  });

  it("test_extra_ 別のコードを受け付けた直後は、そちらがかざしたまま扱いになる", () => {
    const gate = createScanGate();
    gate.accept(["1001"], 0);
    gate.accept(["2001"], 200);
    expect(gate.accept(["2001"], 400)).toEqual([]);
  });

  it("test_extra_ 判定の状態を取り出せる（開発環境の表示用）", () => {
    const gate = createScanGate();
    expect(gate.state()).toBeNull();
    expect(gate.lastAccept()).toBeNull();

    gate.accept(["1001"], 0);
    expect(gate.state()).toEqual({ code: "1001", lastSeenAt: 0, misses: 0 });
    expect(gate.lastAccept()).toEqual({ code: "1001", sinceLastSeenMs: null, misses: 0 });

    gate.accept([], 200);
    gate.accept([], 400);
    expect(gate.state()).toEqual({ code: "1001", lastSeenAt: 0, misses: 2 });
  });

  it("test_extra_ 受け付けたときに、前回の検出からの経過時間と misses を記録する（ログ用）", () => {
    const gate = createScanGate();
    gate.accept(["1001"], 0);
    frames(gate, 0, SCAN_RELEASE_FRAMES); // 200〜1000ms は読めない
    gate.accept(["1001"], 1200);
    expect(gate.lastAccept()).toEqual({ code: "1001", sinceLastSeenMs: 1200, misses: SCAN_RELEASE_FRAMES });
  });

  it("test_extra_ 何も読めないフレームだけでは何も受け付けない", () => {
    expect(createScanGate().accept([], 1000)).toEqual([]);
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
