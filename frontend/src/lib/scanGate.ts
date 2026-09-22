// スキャンの重複防止（design.md 6.4）。カメラはかざしている間ずっと同じコードを読み続けるため、
// そのままでは同じ商品が何件も追加される。
// 同じコードを再び受け付けるのは「一度離した」と確実に言える場合だけとし、次の2つをともに満たすことを条件にする。
//   - 最後にそのコードを検出してから SCAN_RELEASE_MS 以上たっている
//   - 読み取りを試みたフレームのうち、連続 SCAN_RELEASE_FRAMES 回そのコードが検出されていない
// 時間だけで解除すると、手ぶれなどで読み取りが一瞬途切れただけでも解除されてしまうため、フレーム数も条件に加える。
// 別のコードはすぐ受け付ける。手入力はこの仕組みを通らない。

export const SCAN_RELEASE_MS = 1000;
export const SCAN_RELEASE_FRAMES = 5;

export type ScanGate = {
  /** 映像1フレーム分の読み取り結果（読めなければ空）を渡し、受け付けるコードだけを返す */
  accept: (detected: readonly string[], now: number) => string[];
};

type Held = { code: string; lastSeenAt: number; misses: number };

export const createScanGate = (
  releaseMs: number = SCAN_RELEASE_MS,
  releaseFrames: number = SCAN_RELEASE_FRAMES,
): ScanGate => {
  // 直近に受け付けたコードと、最後に見えた時刻・そのあと連続して見えなかったフレーム数
  let held: Held | null = null;

  return {
    accept(detected, now) {
      if (held !== null) {
        if (detected.includes(held.code)) {
          // まだ見えている：離れていた時間もフレーム数も数え直す
          held = { code: held.code, lastSeenAt: now, misses: 0 };
        } else {
          const misses = held.misses + 1;
          held =
            now - held.lastSeenAt >= releaseMs && misses >= releaseFrames
              ? null // 一度離したと判断する
              : { ...held, misses };
        }
      }

      const accepted: string[] = [];
      for (const code of detected) {
        if (held?.code === code) {
          continue;
        }
        accepted.push(code);
        held = { code, lastSeenAt: now, misses: 0 };
      }
      return accepted;
    },
  };
};
