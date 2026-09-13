// 購入確定の冪等キー（design.md 4.1・6.2、NFR-OPS-05）
// 購入ボタンを最初に押したときに作り、購入リストと会員が変わらない限り同じキーを使う（人間が決定）
import type { CartLine } from "@/lib/pricing";

export type PendingKey = { key: string; fingerprint: string };

// キーを作り直すかどうかの判定に使う「購入内容」
export const purchaseFingerprint = (memberId: string | null, lines: readonly CartLine[]): string =>
  JSON.stringify({ memberId, lines: lines.map((line) => [line.code, line.qty]) });

export const reuseOrCreateKey = (
  pending: PendingKey | null,
  fingerprint: string,
  generate: () => string,
): PendingKey => (pending !== null && pending.fingerprint === fingerprint ? pending : { key: generate(), fingerprint });
