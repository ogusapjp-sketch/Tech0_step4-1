// スキャンの重複防止（design.md 6.4）。カメラはかざしている間ずっと同じコードを読み続けるため、
// そのままでは同じ商品が何件も追加される。
// 同じコードを再び受け付けるのは「一度離した」と確実に言える場合だけとし、次の2つをともに満たすことを条件にする。
//   - 最後にそのコードを検出してから SCAN_RELEASE_MS 以上たっている
//   - 読み取りを試みたフレームのうち、連続 SCAN_RELEASE_FRAMES 回そのコードが検出されていない
// 時間だけで解除すると、手ぶれなどで読み取りが一瞬途切れただけでも解除されてしまうため、フレーム数も条件に加える。
// 別のコードはすぐ受け付ける。手入力はこの仕組みを通らない。

export const SCAN_RELEASE_MS = 1000;
export const SCAN_RELEASE_FRAMES = 5;

/** 直近に受け付けたコードと、最後に見えた時刻・そのあと連続して見えなかったフレーム数 */
export type Held = { code: string; lastSeenAt: number; misses: number };

/** 受け付けたときの記録。開発環境のログに使う */
export type AcceptInfo = {
  code: string;
  /** 前回そのコードを検出してからの経過ミリ秒。初回は null */
  sinceLastSeenMs: number | null;
  /** 受け付けた時点で、連続して検出されなかったフレーム数 */
  misses: number;
};

export type ScanGate = {
  /** 映像1フレーム分の読み取り結果（読めなければ空）を渡し、受け付けるコードだけを返す */
  accept: (detected: readonly string[], now: number) => string[];
  /** 判定の状態。開発環境の表示に使う */
  state: () => Held | null;
  /** 直近に受け付けたときの記録。開発環境のログに使う */
  lastAccept: () => AcceptInfo | null;
};

export const createScanGate = (
  releaseMs: number = SCAN_RELEASE_MS,
  releaseFrames: number = SCAN_RELEASE_FRAMES,
): ScanGate => {
  let held: Held | null = null;
  // 解除した（＝一度離したと判断した）ときの状態と、直近に受け付けたときの記録
  let released: Held | null = null;
  let accepted: AcceptInfo | null = null;

  return {
    state: () => (held === null ? null : { ...held }),
    lastAccept: () => (accepted === null ? null : { ...accepted }),

    accept(detected, now) {
      if (held !== null) {
        if (detected.includes(held.code)) {
          // まだ見えている：離れていた時間もフレーム数も数え直す
          held = { code: held.code, lastSeenAt: now, misses: 0 };
        } else {
          const misses = held.misses + 1;
          if (now - held.lastSeenAt >= releaseMs && misses >= releaseFrames) {
            // 一度離したと判断する。解除したときの状態は、次に受け付けたときのログのために残す
            released = { ...held, misses };
            held = null;
          } else {
            held = { ...held, misses };
          }
        }
      }

      const codes: string[] = [];
      for (const code of detected) {
        if (held?.code === code) {
          continue;
        }
        const from = released !== null && released.code === code ? released : null;
        accepted = {
          code,
          sinceLastSeenMs: from === null ? null : Math.round(now - from.lastSeenAt),
          misses: from === null ? 0 : from.misses,
        };
        codes.push(code);
        held = { code, lastSeenAt: now, misses: 0 };
      }
      return codes;
    },
  };
};

// 画面で1つだけ持つゲート。コンポーネントが作り直されても（再マウント）状態を失わないようにする。
// 読み取りは画面に1か所しかないため、共有して問題ない
let shared: ScanGate | null = null;

export const getSharedScanGate = (): ScanGate => {
  shared ??= createScanGate();
  return shared;
};

/** テスト用。ケースごとに初期状態へ戻す */
export const resetSharedScanGate = (): void => {
  shared = null;
};
