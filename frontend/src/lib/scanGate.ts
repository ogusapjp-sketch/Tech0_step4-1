// スキャンの重複防止（design.md 6.4）。カメラはかざしている間ずっと同じコードを読み続けるため、
// 読み取るたびに登録すると同じ商品が何件も追加される。
//
// 1フレームに複数のバーコードが写ることがある（メニュー早見表は複数のカードが並ぶ）。
// そのままでは、写っているコードが交互に「別のコード」として受け付けられてしまうため、
// フレームごとに受付を判定するのは1つだけ（映像の中心に最も近いもの）とし、状態はコードごとに持つ。
// 写っているコードは採用の有無に関係なく「見えている」として扱い、未検出のフレーム数は増やさない。
//
// 受付の条件（採用したコードについて）
//   - まだ受け付けたことがないコード → 受け付ける
//   - 受け付けたことがあるコード → 「離した」と判定済みのときだけ受け付ける
//   - 「離した」＝ misses（連続未検出フレーム数）が SCAN_RELEASE_FRAMES 以上、
//     かつ lastSeenAt からの経過が SCAN_RELEASE_MS 以上
// 手入力はこの仕組みを通らない。

export const SCAN_RELEASE_MS = 1000;
export const SCAN_RELEASE_FRAMES = 5;
// これだけ連続で検出されなければ、状態を捨てる（早見表を持ち替えたあとの再スキャンに備える）
export const SCAN_FORGET_FRAMES = 30;

/** 読み取ったバーコード1件。boundingBox は Barcode Detection API の値 */
export type ScannedBarcode = {
  rawValue: string;
  boundingBox?: { x: number; y: number; width: number; height: number };
};

/** コードごとの状態 */
export type CodeState = {
  /** そのコードを最後に検出した時刻（採用されたかどうかに関係なく更新する） */
  lastSeenAt: number;
  /** そのコードが連続して検出されなかったフレーム数 */
  misses: number;
  /** 一度受け付けたあと、「離した」と判定済みか */
  released: boolean;
  /** これまでに受け付けたことがあるか */
  everAccepted: boolean;
};
export type ScanStates = ReadonlyMap<string, CodeState>;

export type AcceptReason = "初出" | "離した後の再受付";

export type ScanDecision = {
  states: ScanStates;
  /** このフレームで受け付けたコード。なければ null */
  accepted: string | null;
  reason: AcceptReason | null;
  /** 同じコードを受け付けたときの、前回の検出からの経過ミリ秒 */
  sinceLastSeenMs: number | null;
  /** 受け付けた時点の misses */
  missesAtAccept: number;
};

/**
 * 1フレームの読み取り結果から、採用する1件を選ぶ。
 * 複数写っているときは boundingBox の中心が映像の中心に最も近いものを採る。
 * boundingBox がない場合は先頭を採る。
 */
export const pickCenterMost = (
  barcodes: readonly ScannedBarcode[],
  videoWidth: number,
  videoHeight: number,
): string | null => {
  if (barcodes.length === 0) {
    return null;
  }
  const centerX = videoWidth / 2;
  const centerY = videoHeight / 2;
  let picked = barcodes[0];
  let shortest = Number.POSITIVE_INFINITY;
  for (const barcode of barcodes) {
    const box = barcode.boundingBox;
    if (box === undefined) {
      continue;
    }
    const dx = box.x + box.width / 2 - centerX;
    const dy = box.y + box.height / 2 - centerY;
    const distance = dx * dx + dy * dy;
    if (distance < shortest) {
      shortest = distance;
      picked = barcode;
    }
  }
  return picked.rawValue;
};

/**
 * 1フレームの結果から、次の状態と受け付けるコードを決める。副作用を持たない。
 *
 * - `detected`：そのフレームで検出したコード全部。採用の有無に関係なく状態を持ち、`lastSeenAt` を更新して `misses` を 0 に戻す
 * - `picked`：受付の判定を行う1件（映像の中心に最も近いもの）。読めなければ null
 * - 検出されなかった既知のコードだけ `misses` を増やし、「離した」の判定と削除を行う
 */
export const nextScanState = (
  states: ScanStates,
  detected: readonly string[],
  picked: string | null,
  now: number,
  releaseMs: number = SCAN_RELEASE_MS,
  releaseFrames: number = SCAN_RELEASE_FRAMES,
  forgetFrames: number = SCAN_FORGET_FRAMES,
): ScanDecision => {
  const next = new Map<string, CodeState>();
  let accepted: string | null = null;
  let reason: AcceptReason | null = null;
  let sinceLastSeenMs: number | null = null;
  let missesAtAccept = 0;

  // 検出されなかった既知のコード：未検出のフレーム数を増やす
  for (const [code, state] of states) {
    if (detected.includes(code)) {
      continue; // 検出されたものは下でまとめて更新する
    }
    const misses = state.misses + 1;
    if (misses >= forgetFrames) {
      continue; // 十分に見えなくなったら忘れる
    }
    const released = state.released || (misses >= releaseFrames && now - state.lastSeenAt >= releaseMs);
    next.set(code, { ...state, misses, released });
  }

  // 検出されたコード：採用の有無に関係なく、最後に見えた時刻を更新して misses を 0 に戻す。
  // 「離した」かどうか（released）と「受け付けたことがあるか」（everAccepted）は引き継ぐ
  for (const code of detected) {
    const state = states.get(code);
    next.set(code, {
      lastSeenAt: now,
      misses: 0,
      released: state?.released ?? false,
      everAccepted: state?.everAccepted ?? false,
    });
  }

  // 受付の判定は、採用した1件についてだけ行う
  if (picked !== null) {
    const state = states.get(picked);
    const firstTime = state === undefined || !state.everAccepted;
    if (firstTime || state.released) {
      accepted = picked;
      reason = firstTime ? "初出" : "離した後の再受付";
      sinceLastSeenMs = state === undefined ? null : Math.round(now - state.lastSeenAt);
      missesAtAccept = state?.misses ?? 0;
      next.set(picked, { lastSeenAt: now, misses: 0, released: false, everAccepted: true });
    }
  }

  return { states: next, accepted, reason, sinceLastSeenMs, missesAtAccept };
};

// 状態は画面で1つだけ持つ。再描画でも、カメラの部品が作り直されても失わない
const sharedRef: { current: ScanStates } = { current: new Map() };

export const getSharedScanStatesRef = (): { current: ScanStates } => sharedRef;

/** テスト用。ケースごとに初期状態へ戻す */
export const resetSharedScanStates = (): void => {
  sharedRef.current = new Map();
};
