// ログイン担当者情報（requirements.md 5.3）
import type { StaffIdentity } from "@/lib/api";

import styles from "./RegisterScreen.module.css";

type Props = {
  staff: StaffIdentity | null;
  onLogout: () => void;
};

export function StaffBar({ staff, onLogout }: Props) {
  return (
    <header className={styles.staffBar}>
      <p aria-label="担当者" className={styles.staff}>
        担当者：<strong>{staff?.name ?? "—"}</strong>
      </p>
      <button type="button" className={styles.secondaryButton} onClick={onLogout}>
        ログアウト
      </button>
    </header>
  );
}
