// 利用者向けの文言。文言はフロントが持ち、バックエンドの message は使わない（design.md 6.2）
import { LINES_MAX } from "@/lib/cartReducer";

// エラーコード → 画面表示（design.md 6.2 の表のとおり）
// - VALIDATION_ERROR は「該当項目の制約を表示」のため、操作ごとの文言（CLIENT_MESSAGES.INVALID_*）を出す
// - TOKEN_INVALID・TOKEN_EXPIRED（401）はログイン画面へ移す
// - DUPLICATE は完了扱いにして文言を出さない
const ERROR_MESSAGES: Readonly<Record<string, string>> = {
  AUTH_FAILED: "担当者IDまたはパスワードが正しくありません",
  AUTH_LOCKED: "一定時間後に再試行してください",
  MEMBER_NOT_FOUND: "該当する会員が存在しません",
  PRODUCT_NOT_FOUND: "商品がマスタ未登録です",
  TOTALS_MISMATCH: "金額の再計算が必要です。画面を更新してください",
  INTERNAL_ERROR: "処理に失敗しました。もう一度お試しください",
};

// 画面側で判定する事象の文言
export const CLIENT_MESSAGES = {
  ADDED: "1件追加されました",
  NETWORK: "通信できません",
  QUANTITY_LIMIT: "上限に達しています",
  LINE_LIMIT: `購入リストは${LINES_MAX}行までです`,
  QUANTITY_RANGE: "数量は1〜99で入力してください",
  INVALID_PRODUCT_CODE: "商品コードは数字（20桁まで）で入力してください",
  INVALID_MEMBER_ID: "会員IDは M と数字（20文字まで）で入力してください",
  INVALID_SCAN: "読み取ったコードは会員IDでも商品コードでもありません",
  INVALID_LOGIN_INPUT: "担当者IDは英数字と - _ の20文字まで、パスワードは12〜128文字で入力してください",
  INVALID_PURCHASE: "購入内容に誤りがあります。画面を更新してください",
  CAMERA_UNAVAILABLE: "カメラを利用できません。商品コード・会員IDを手入力してください",
} as const;

// 表にないコードは想定外の例外（500）と同じ文言にする
export const messageForError = (code: string | null): string =>
  (code !== null ? ERROR_MESSAGES[code] : undefined) ?? ERROR_MESSAGES.INTERNAL_ERROR;
