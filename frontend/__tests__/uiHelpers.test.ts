// 画面で使う純粋な関数。test_spec.md にケース ID がないため test_extra_
import { purchaseFingerprint, reuseOrCreateKey } from "@/lib/idempotencyKey";
import { CLIENT_MESSAGES, messageForError } from "@/lib/messages";
import { INITIAL_SCAN_STATE, SCAN_RELEASE_FRAMES, SCAN_RELEASE_MS, nextScanState, type ScanState } from "@/lib/scanGate";
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

describe("スキャンの重複防止（判定の純粋関数。design.md 6.4）", () => {
  // 1フレームぶん進める。読めたコードと時刻を渡し、受け付けた件数を数える
  type Run = { state: ScanState; accepted: string[]; reasons: (string | null)[] };

  const run = (frames: { codes: string[]; at: number }[], from: ScanState = INITIAL_SCAN_STATE): Run => {
    let state = from;
    const accepted: string[] = [];
    const reasons: (string | null)[] = [];
    for (const frame of frames) {
      const decision = nextScanState(state, frame.codes, frame.at);
      state = decision.state;
      accepted.push(...decision.accepted);
      if (decision.accepted.length > 0) {
        reasons.push(decision.reason);
      }
    }
    return { state, accepted, reasons };
  };

  const repeat = (codes: string[], count: number, from = 0, step = 250) =>
    Array.from({ length: count }, (_, i) => ({ codes, at: from + i * step }));

  it("test_extra_ 同じコードを 250ms 間隔で 40回（10秒）検出しても、受付は1回", () => {
    const { accepted, reasons, state } = run(repeat(["1001"], 40));
    expect(accepted).toEqual(["1001"]);
    expect(reasons).toEqual(["初回"]);
    expect(state.misses).toBe(0);
    expect(state.released).toBe(false);
  });

  it("test_extra_ 未検出が5フレーム・1000ms 以上続いたあとに検出したら、受付は2回", () => {
    const { accepted, reasons } = run([
      { codes: ["1001"], at: 0 },
      ...repeat([], SCAN_RELEASE_FRAMES, 250), // 250〜1250ms は読めない
      { codes: ["1001"], at: 1500 },
    ]);
    expect(accepted).toEqual(["1001", "1001"]);
    expect(reasons).toEqual(["初回", "離したあとの再検出"]);
  });

  it("test_extra_ 未検出が4フレームだけなら、受付は1回のまま", () => {
    const { accepted, state } = run([
      { codes: ["1001"], at: 0 },
      ...repeat([], SCAN_RELEASE_FRAMES - 1, 250),
      { codes: ["1001"], at: 1500 },
    ]);
    expect(accepted).toEqual(["1001"]);
    expect(state.released).toBe(false);
  });

  it("test_extra_ 別のコードならすぐ受け付ける（A → B で2回）", () => {
    const { accepted, reasons } = run([
      { codes: ["1001"], at: 0 },
      { codes: ["2001"], at: 250 },
    ]);
    expect(accepted).toEqual(["1001", "2001"]);
    expect(reasons).toEqual(["初回", "別のコード"]);
  });

  it("test_extra_ 時間がたっていても、未検出フレームが5回に満たなければ受け付けない", () => {
    const { accepted } = run([
      { codes: ["1001"], at: 0 },
      ...repeat([], SCAN_RELEASE_FRAMES - 1, 1000, 1000), // 4フレーム・4秒
      { codes: ["1001"], at: 10000 },
    ]);
    expect(accepted).toEqual(["1001"]);
  });

  it("test_extra_ フレーム数が足りていても、1000ms たっていなければ受け付けない", () => {
    const { accepted } = run([
      { codes: ["1001"], at: 0 },
      ...repeat([], 10, 50, 50), // 50ms ごとに10フレーム（500ms）
      { codes: ["1001"], at: 600 },
    ]);
    expect(accepted).toEqual(["1001"]);
  });

  it("test_extra_ 途中で一度でも検出されたら、経過時間もフレーム数も数え直す", () => {
    const { accepted } = run([
      { codes: ["1001"], at: 0 },
      ...repeat([], 4, 250), // 未検出4回
      { codes: ["1001"], at: 1250 }, // 再び検出 → 数え直し
      ...repeat([], 4, 1500), // 未検出4回
      { codes: ["1001"], at: 2600 },
    ]);
    expect(accepted).toEqual(["1001"]);
  });

  it("test_extra_ 受け付けたときに、前回の検出からの経過時間と misses を返す（ログ用）", () => {
    let state = nextScanState(INITIAL_SCAN_STATE, ["1001"], 0).state;
    for (let i = 1; i <= SCAN_RELEASE_FRAMES; i += 1) {
      state = nextScanState(state, [], i * 250).state;
    }
    const decision = nextScanState(state, ["1001"], 1500);
    expect(decision.accepted).toEqual(["1001"]);
    expect(decision.sinceLastSeenMs).toBe(1500);
    expect(decision.missesAtAccept).toBe(SCAN_RELEASE_FRAMES);
  });

  it("test_extra_ 何も読めないフレームだけでは何も受け付けない", () => {
    const { accepted, state } = run(repeat([], 20));
    expect(accepted).toEqual([]);
    expect(state.lastCode).toBeNull();
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
