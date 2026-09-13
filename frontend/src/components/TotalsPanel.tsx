// 合計表示（requirements.md 5.3、FR-009）。設定（税率・企画）を取得するまでは表示しない
import { formatYen } from "@/lib/format";
import type { Totals } from "@/lib/pricing";

import styles from "./RegisterScreen.module.css";

type Props = {
  totals: Totals | null;
};

export function TotalsPanel({ totals }: Props) {
  const rows: [string, number | undefined][] = [
    ["税抜合計", totals?.subtotal],
    ["値引き合計", totals?.discountTotal],
    ["消費税", totals?.taxAmount],
    ["税込合計", totals?.total],
  ];
  return (
    <dl aria-label="合計" className={styles.totals}>
      {rows.map(([label, value]) => (
        <div key={label} className={label === "税込合計" ? styles.grandTotal : styles.totalRow}>
          <dt>{label}</dt>
          <dd aria-label={label}>{value === undefined ? "—" : formatYen(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
