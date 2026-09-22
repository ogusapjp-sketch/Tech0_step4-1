// スキャンの重複防止（design.md 6.4）。カメラはかざしている間ずっと同じコードを読み続けるため、
// 読み取るたびに登録すると同じ商品が何件も追加される。
//
// 判定は次のとおり（純粋関数 nextScanState。BarcodeDetector・ZXing の両経路がこの関数を通る）。
//   - 検出したコードが直前に受け付けたコード（lastCode）と違う → 受け付ける
//   - 同じコードは、「離した」と判定済みのときだけ受け付ける
//   - 「離した」＝ misses（連続未検出フレーム数）が SCAN_RELEASE_FRAMES 以上、
//     かつ lastSeenAt からの経過が SCAN_RELEASE_MS 以上
//   - 同じコードを検出し続けている間は、受け付けずに lastSeenAt を更新し misses を 0 に戻すだけ
//   - 前回「受け付けた」時刻からの経過時間で再受付することはない
// 手入力はこの仕組みを通らない。

export const SCAN_RELEASE_MS = 1000;
export const SCAN_RELEASE_FRAMES = 5;

export type ScanState = {
  /** 直前に受け付けたコード */
  lastCode: string | null;
  /** lastCode を最後に検出した時刻 */
  lastSeenAt: number;
  /** lastCode が連続して検出されなかったフレーム数 */
  misses: number;
  /** lastCode を「離した」と判定済みか */
  released: boolean;
};

/** 受け付けた理由。開発環境の表示とログに使う */
export type AcceptReason = "初回" | "別のコード" | "離したあとの再検出";

export type ScanDecision = {
  state: ScanState;
  /** このフレームで受け付けたコード */
  accepted: string[];
  reason: AcceptReason | null;
  /** 同じコードを受け付けたときの、前回の検出からの経過ミリ秒 */
  sinceLastSeenMs: number | null;
  /** 受け付けた時点の misses */
  missesAtAccept: number;
};

export const INITIAL_SCAN_STATE: ScanState = { lastCode: null, lastSeenAt: 0, misses: 0, released: false };

/**
 * 映像1フレーム分の読み取り結果（読めなければ空）から、次の状態と受け付けるコードを決める。
 * 副作用を持たない。時刻はすべて引数で受け取る。
 */
export const nextScanState = (
  state: ScanState,
  detected: readonly string[],
  now: number,
  releaseMs: number = SCAN_RELEASE_MS,
  releaseFrames: number = SCAN_RELEASE_FRAMES,
): ScanDecision => {
  let { lastCode, lastSeenAt, misses, released } = state;
  // 報告用に、このフレームを反映する前の値を控える（同じコードを受け付けたときの経過時間と misses）
  const before = { lastSeenAt: state.lastSeenAt, misses: state.misses };

  if (lastCode !== null) {
    if (detected.includes(lastCode)) {
      // 検出し続けている間は受け付けず、経過時間とフレーム数を数え直すだけ
      lastSeenAt = now;
      misses = 0;
    } else {
      misses += 1;
      if (!released && misses >= releaseFrames && now - lastSeenAt >= releaseMs) {
        released = true;
      }
    }
  }

  const accepted: string[] = [];
  let reason: AcceptReason | null = null;
  let sinceLastSeenMs: number | null = null;
  let missesAtAccept = 0;

  for (const code of detected) {
    const sameCode = code === lastCode;
    if (sameCode && !released) {
      continue; // かざしたまま。離したと判定するまで受け付けない
    }
    reason = sameCode ? "離したあとの再検出" : lastCode === null ? "初回" : "別のコード";
    sinceLastSeenMs = sameCode ? Math.round(now - before.lastSeenAt) : null;
    missesAtAccept = sameCode ? before.misses : 0;
    accepted.push(code);
    lastCode = code;
    lastSeenAt = now;
    misses = 0;
    released = false;
  }

  return { state: { lastCode, lastSeenAt, misses, released }, accepted, reason, sinceLastSeenMs, missesAtAccept };
};

// 状態は画面で1つだけ持つ。再描画でも、カメラの部品が作り直されても失わない
const sharedRef: { current: ScanState } = { current: INITIAL_SCAN_STATE };

export const getSharedScanStateRef = (): { current: ScanState } => sharedRef;

/** テスト用。ケースごとに初期状態へ戻す */
export const resetSharedScanState = (): void => {
  sharedRef.current = INITIAL_SCAN_STATE;
};
