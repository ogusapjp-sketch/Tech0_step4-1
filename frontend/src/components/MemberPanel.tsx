// 会員ID欄（requirements.md 5.3）。表示は会員ID・氏名・割引対象である旨に限る（NFR-SEC-09）
import type { Member } from "@/lib/api";

import styles from "./RegisterScreen.module.css";

type Props = {
  member: Member | null;
  memberInput: string;
  onMemberInputChange: (value: string) => void;
  onLookup: () => void;
  onNoMember: () => void;
};

export function MemberPanel({ member, memberInput, onMemberInputChange, onLookup, onNoMember }: Props) {
  return (
    <section aria-label="会員" className={styles.panel}>
      <form
        className={styles.inlineForm}
        onSubmit={(event) => {
          event.preventDefault();
          onLookup();
        }}
      >
        <label className={styles.field}>
          会員ID
          <input value={memberInput} onChange={(event) => onMemberInputChange(event.target.value)} autoComplete="off" />
        </label>
        <button type="submit" className={styles.secondaryButton}>
          会員読込
        </button>
        <button type="button" className={styles.secondaryButton} onClick={onNoMember}>
          会員なし
        </button>
      </form>
      <p aria-label="会員情報" className={styles.memberInfo}>
        {member ? (
          <>
            {member.name}（{member.member_id}）<span className={styles.badge}>割引対象</span>
          </>
        ) : (
          "会員なし"
        )}
      </p>
    </section>
  );
}
