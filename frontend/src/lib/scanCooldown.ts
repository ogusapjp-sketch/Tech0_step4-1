// スキャンの重複防止。カメラは連続して読み取るため、かざしている間に同じ商品が何件も追加されないようにする
// 別のコードはすぐ受け付け、同じコードは一定時間おいてから受け付ける（同じ商品を続けてスキャンして数量を加算できる）

export const SCAN_COOLDOWN_MS = 1500;

export type LastScan = { code: string; at: number };

export const acceptScan = (last: LastScan | null, code: string, now: number): boolean =>
  last === null || last.code !== code || now - last.at >= SCAN_COOLDOWN_MS;
