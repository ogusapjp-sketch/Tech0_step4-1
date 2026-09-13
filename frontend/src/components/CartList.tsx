// 購入リスト（requirements.md 5.3）。名称・数量・単価・値引き額・小計を行ごとに表示し、選択行を強調表示する
import { formatNumber, formatYen } from "@/lib/format";
import { calcLineDiscount, type CartLine, type DiscountCampaign } from "@/lib/pricing";

import styles from "./RegisterScreen.module.css";

type Props = {
  lines: readonly CartLine[];
  memberId: string | null;
  campaigns: readonly DiscountCampaign[];
  selectedCode: string | null;
  onSelect: (code: string) => void;
};

export function CartList({ lines, memberId, campaigns, selectedCode, onSelect }: Props) {
  return (
    <table aria-label="購入リスト" className={styles.cart}>
      <thead>
        <tr>
          <th scope="col">商品名</th>
          <th scope="col">数量</th>
          <th scope="col">単価</th>
          <th scope="col">値引き</th>
          <th scope="col">小計</th>
        </tr>
      </thead>
      <tbody>
        {lines.map((line) => {
          // 値引きは会員IDの読込順に関係なく、表示のたびに再評価する（requirements.md 7章③）
          const discount = calcLineDiscount(line, memberId, campaigns);
          const selected = line.code === selectedCode;
          return (
            <tr
              key={line.code}
              aria-selected={selected}
              className={selected ? styles.selectedRow : styles.row}
              onClick={() => onSelect(line.code)}
            >
              <td>{line.name}</td>
              <td aria-label="数量" className={styles.number}>
                {line.qty}
              </td>
              <td className={styles.number}>{formatYen(line.unitPrice)}</td>
              <td aria-label="値引き" className={styles.number}>
                {discount > 0 ? `−${formatNumber(discount)}` : "0"}
              </td>
              <td className={styles.number}>{formatYen(line.unitPrice * line.qty - discount)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
