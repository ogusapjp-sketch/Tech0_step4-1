// 購入完了ポップアップ（requirements.md 5.3、FR-010・FR-011）。閉じると画面をクリアする
import { formatYen } from "@/lib/format";

import styles from "./RegisterScreen.module.css";

type Props = {
  total: number;
  onClose: () => void;
};

export function CompletionDialog({ total, onClose }: Props) {
  return (
    <div className={styles.backdrop}>
      <div role="dialog" aria-modal="true" aria-label="購入完了" className={styles.dialog}>
        <p>購入が確定しました</p>
        <p className={styles.dialogLabel}>税込合計</p>
        <p className={styles.dialogTotal}>{formatYen(total)}</p>
        <button type="button" className={styles.primaryButton} onClick={onClose} autoFocus>
          閉じる
        </button>
      </div>
    </div>
  );
}
