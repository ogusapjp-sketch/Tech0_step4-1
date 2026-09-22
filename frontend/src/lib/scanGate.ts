// スキャンの重複防止。カメラはかざしている間ずっと同じコードを読み続けるため、そのままでは何件も追加されてしまう
// 同じコードは「映像から連続 SCAN_RELEASE_MS 検出されなくなる（＝一度離した）」まで受け付けない
// 別のコードはすぐ受け付ける。手入力はこの仕組みを通らない

export const SCAN_RELEASE_MS = 500;

export type ScanGate = {
  /** 映像1フレーム分の読み取り結果を渡し、受け付けるコードだけを返す */
  accept: (detected: readonly string[], now: number) => string[];
};

export const createScanGate = (releaseMs: number = SCAN_RELEASE_MS): ScanGate => {
  // 直近に受け付けたコードと、それが最後に映像で見えた時刻
  let held: { code: string; lastSeenAt: number } | null = null;

  return {
    accept(detected, now) {
      if (held !== null) {
        if (now - held.lastSeenAt >= releaseMs) {
          // 最後に見えてから releaseMs 以上あいた＝一度離した。次に見えたら受け付ける
          held = null;
        } else if (detected.includes(held.code)) {
          // まだ見えている（またはすぐ映り直した）：離れていた時間を数え直す
          held = { code: held.code, lastSeenAt: now };
        }
      }

      const accepted: string[] = [];
      for (const code of detected) {
        if (held?.code === code) {
          continue;
        }
        accepted.push(code);
        held = { code, lastSeenAt: now };
      }
      return accepted;
    },
  };
};
