// 選択商品の操作（requirements.md 5.3、FR-007）。選択行の名称・単価・数量を表示し、数量変更と削除を行う
import { useState } from "react";

import { QUANTITY_MAX, QUANTITY_MIN } from "@/lib/cartReducer";
import { formatYen } from "@/lib/format";
import type { CartLine } from "@/lib/pricing";

import styles from "./RegisterScreen.module.css";

type Props = {
  line: CartLine | null;
  onChangeQuantity: (qty: number) => void;
  onRemove: () => void;
};

export function SelectedLinePanel({ line, onChangeQuantity, onRemove }: Props) {
  const [quantity, setQuantity] = useState(line ? String(line.qty) : "");

  if (!line) {
    return (
      <section aria-label="選択中の商品" className={styles.panel}>
        <p className={styles.hint}>商品を選択してください</p>
      </section>
    );
  }

  return (
    <section aria-label="選択中の商品" className={styles.panel}>
      <p className={styles.selectedInfo}>
        <span>{line.name}</span>
        <span>{formatYen(line.unitPrice)}</span>
        <span>数量 {line.qty}</span>
      </p>
      <div className={styles.inlineForm}>
        <label className={styles.field}>
          変更する数量
          <input
            type="number"
            min={QUANTITY_MIN}
            max={QUANTITY_MAX}
            step={1}
            value={quantity}
            onChange={(event) => setQuantity(event.target.value)}
          />
        </label>
        <button type="button" className={styles.secondaryButton} onClick={() => onChangeQuantity(Number(quantity))}>
          数量を変更
        </button>
        <button type="button" className={styles.dangerButton} onClick={onRemove}>
          削除
        </button>
      </div>
    </section>
  );
}
