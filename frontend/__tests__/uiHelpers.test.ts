// 画面で使う純粋な関数。test_spec.md にケース ID がないため test_extra_
import { purchaseFingerprint, reuseOrCreateKey } from "@/lib/idempotencyKey";
import { CLIENT_MESSAGES, messageForError } from "@/lib/messages";
import {
  FORGET_MISSES,
  RELEASE_MISSES,
  STABLE_FRAMES,
  nextScanState,
  pickCenterMost,
  type ScanStates,
} from "@/lib/scanGate";
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

describe("1フレームから1件を選ぶ（design.md 6.4）", () => {
  const box = (x: number, y: number) => ({ x, y, width: 100, height: 40 });
  // 映像は 640x480。中心は (320, 240)
  const near = { rawValue: "1004", boundingBox: box(270, 220) };
  const far = { rawValue: "1002", boundingBox: box(20, 20) };

  it("test_extra_ 何も読めなければ null", () => {
    expect(pickCenterMost([], 640, 480)).toBeNull();
  });

  it.each([
    { label: "近い方が先", barcodes: [near, far] },
    { label: "遠い方が先", barcodes: [far, near] },
  ])("test_extra_ 中心に近いものを採る（$label）", ({ barcodes }) => {
    expect(pickCenterMost(barcodes, 640, 480)).toBe("1004");
  });

  it("test_extra_ boundingBox がなければ先頭を採る（ZXing 経路）", () => {
    expect(pickCenterMost([{ rawValue: "M000001" }], 0, 0)).toBe("M000001");
  });
});

describe("スキャンの重複防止（判定の純粋関数。design.md 6.4）", () => {
  type Frame = { codes: string[]; picked: string | null; at: number };
  const STEP = 250;

  const run = (frames: Frame[], from: ScanStates = new Map()) => {
    let states = from;
    const accepted: string[] = [];
    const reasons: (string | null)[] = [];
    for (const frame of frames) {
      const decision = nextScanState(states, frame.codes, frame.picked, frame.at);
      states = decision.states;
      if (decision.accepted !== null) {
        accepted.push(decision.accepted);
        reasons.push(decision.reason);
      }
    }
    return { states, accepted, reasons };
  };

  /** 同じ内容のフレームを count 回並べる。at は STEP ごとに進む */
  const frames = (codes: string[], picked: string | null, count: number, from = 0): Frame[] =>
    Array.from({ length: count }, (_, i) => ({ codes, picked, at: from + i * STEP }));

  const holding = (code: string | null, count: number, from = 0): Frame[] =>
    frames(code === null ? [] : [code], code, count, from);

  // --- 採用の安定性（test_spec.md 4.2.5） ---

  it("test_UT_F_42_wobbling_center_does_not_accept_the_neighbour", () => {
    // A が3フレーム続いて受け付けられたあと、中心が A,A,B,A,A,B… と揺れても B は受け付けない
    const wobble: Frame[] = Array.from({ length: 30 }, (_, i) => ({
      codes: ["1002", "1004"],
      picked: i % 3 === 2 ? "1004" : "1002",
      at: (STABLE_FRAMES + i) * STEP,
    }));
    const { accepted } = run([...frames(["1002", "1004"], "1002", STABLE_FRAMES), ...wobble]);
    expect(accepted).toEqual(["1002"]);
  });

  it("test_UT_F_43_center_held_for_three_frames_each_accepts_both", () => {
    // 中心が A を3フレーム → B を3フレーム → それぞれ1回ずつ受け付ける
    const { accepted, reasons } = run([
      ...frames(["1002", "1004"], "1002", STABLE_FRAMES),
      ...frames(["1002", "1004"], "1004", STABLE_FRAMES, STABLE_FRAMES * STEP),
    ]);
    expect(accepted).toEqual(["1002", "1004"]);
    expect(reasons).toEqual(["初出", "初出"]);
  });

  it("test_UT_F_44_two_frames_only_is_not_accepted", () => {
    // 2フレームだけ検出して消えた場合は受け付けない
    const { accepted } = run([...holding("1001", STABLE_FRAMES - 1), ...holding(null, 5, (STABLE_FRAMES - 1) * STEP)]);
    expect(accepted).toEqual([]);
  });

  it("test_UT_F_45_reaccept_after_release_only_for_the_stable_code", () => {
    // A を受付 → A・B とも 12フレーム以上・3000ms 以上未検出 → 戻ってきて中心は A が続き、B は1フレームだけ中心
    const first = [...frames(["1002", "1004"], "1002", STABLE_FRAMES)];
    const away = holding(null, RELEASE_MISSES, STABLE_FRAMES * STEP);
    const back = (STABLE_FRAMES + RELEASE_MISSES) * STEP;
    const returned: Frame[] = [
      { codes: ["1002", "1004"], picked: "1004", at: back }, // B は1フレームだけ中心
      ...frames(["1002", "1004"], "1002", 5, back + STEP),
    ];
    const { accepted, reasons } = run([...first, ...away, ...returned]);
    expect(accepted).toEqual(["1002", "1002"]);
    expect(reasons).toEqual(["初出", "離した後の再受付"]);
  });

  // --- 重複防止（既存。受付までに STABLE_FRAMES かかる前提） ---

  it("test_extra_ 早見表が2枚写り、中心が常に同じなら受付は1回。両方の状態を持つ", () => {
    const wobbleFree: Frame[] = Array.from({ length: 40 }, (_, i) => ({
      codes: i % 2 === 0 ? ["1002", "1004"] : ["1004", "1002"],
      picked: "1004",
      at: i * STEP,
    }));
    const { accepted, states } = run(wobbleFree);
    expect(accepted).toEqual(["1004"]);
    expect(states.size).toBe(2);
    expect(states.get("1002")?.misses).toBe(0);
    expect(states.get("1004")?.misses).toBe(0);
  });

  it("test_extra_ 採用されなかったコードは、写っている間 misses が増えず、安定も 0 のまま", () => {
    const { states } = run(frames(["1002", "1004"], "1004", 20));
    expect(states.get("1002")).toEqual({
      lastSeenAt: 19 * STEP,
      misses: 0,
      released: false,
      everAccepted: false,
      stableFrames: 0,
    });
  });

  it("test_extra_ 同じコードを 250ms 間隔で 40回検出しても、受付は1回", () => {
    const { accepted, reasons } = run(holding("1001", 40));
    expect(accepted).toEqual(["1001"]);
    expect(reasons).toEqual(["初出"]);
  });

  it("test_extra_ 未検出が12フレーム・3000ms 以上続いたあとに検出したら、受付は2回", () => {
    const away = STABLE_FRAMES + RELEASE_MISSES;
    const { accepted, reasons } = run([
      ...holding("1001", STABLE_FRAMES),
      ...holding(null, RELEASE_MISSES, STABLE_FRAMES * STEP),
      ...holding("1001", STABLE_FRAMES, away * STEP),
    ]);
    expect(accepted).toEqual(["1001", "1001"]);
    expect(reasons).toEqual(["初出", "離した後の再受付"]);
  });

  it("test_extra_ 未検出が11フレームだけなら、受付は1回のまま", () => {
    const away = STABLE_FRAMES + RELEASE_MISSES - 1;
    const { accepted } = run([
      ...holding("1001", STABLE_FRAMES),
      ...holding(null, RELEASE_MISSES - 1, STABLE_FRAMES * STEP),
      ...holding("1001", STABLE_FRAMES, away * STEP),
    ]);
    expect(accepted).toEqual(["1001"]);
  });

  it("test_extra_ 別のコードならすぐ受け付ける（A → B で2回）", () => {
    const { accepted } = run([
      ...holding("1001", STABLE_FRAMES),
      ...holding("2001", STABLE_FRAMES, STABLE_FRAMES * STEP),
    ]);
    expect(accepted).toEqual(["1001", "2001"]);
  });

  it("test_extra_ フレーム数が足りていても、3000ms たっていなければ受け付けない", () => {
    // 50ms ごとに 20フレーム（1000ms）離れただけでは、離したと判定しない
    const fast: Frame[] = Array.from({ length: 20 }, (_, i) => ({ codes: [], picked: null, at: 500 + i * 50 }));
    const { accepted } = run([...holding("1001", STABLE_FRAMES), ...fast, ...holding("1001", STABLE_FRAMES, 1600)]);
    expect(accepted).toEqual(["1001"]);
  });

  it("test_extra_ 再受付のときに、離れていた時間と misses・安定フレーム数を返す（ログ用）", () => {
    let states: ScanStates = new Map();
    for (let i = 0; i < STABLE_FRAMES; i += 1) {
      states = nextScanState(states, ["1001"], "1001", i * STEP).states;
    }
    for (let i = 1; i <= RELEASE_MISSES; i += 1) {
      states = nextScanState(states, [], null, (STABLE_FRAMES - 1 + i) * STEP).states;
    }
    const back = (STABLE_FRAMES + RELEASE_MISSES) * STEP;
    for (let i = 0; i < STABLE_FRAMES - 1; i += 1) {
      states = nextScanState(states, ["1001"], "1001", back + i * STEP).states;
    }
    const decision = nextScanState(states, ["1001"], "1001", back + (STABLE_FRAMES - 1) * STEP);
    expect(decision.accepted).toBe("1001");
    expect(decision.reason).toBe("離した後の再受付");
    expect(decision.awayMs).toBe(RELEASE_MISSES * STEP); // 12フレーム×250ms = 3000ms
    expect(decision.awayMisses).toBe(RELEASE_MISSES);
    expect(decision.stableFramesAtAccept).toBe(STABLE_FRAMES);
  });

  it("test_extra_ 長く見えないコードは状態から消える", () => {
    const { states } = run([...holding("1001", 1), ...holding(null, FORGET_MISSES, STEP)]);
    expect(states.size).toBe(0);
  });

  it("test_extra_ 何も読めないフレームだけでは何も受け付けない", () => {
    const { accepted, states } = run(holding(null, 20));
    expect(accepted).toEqual([]);
    expect(states.size).toBe(0);
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
