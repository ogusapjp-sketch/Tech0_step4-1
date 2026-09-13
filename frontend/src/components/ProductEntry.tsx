// 商品コード入力欄・名称単価表示・購入リスト追加操作（requirements.md 5.3）
// 手入力は2段階：照会 → 名称・単価を表示 → 追加（人間が決定）
import type { Product } from "@/lib/cartReducer";
import { formatYen } from "@/lib/format";

import styles from "./RegisterScreen.module.css";

type Props = {
  code: string;
  product: Product | null;
  onCodeChange: (value: string) => void;
  onLookup: () => void;
  onAdd: () => void;
};

export function ProductEntry({ code, product, onCodeChange, onLookup, onAdd }: Props) {
  return (
    <section aria-label="商品登録" className={styles.panel}>
      <form
        className={styles.inlineForm}
        onSubmit={(event) => {
          event.preventDefault();
          onLookup();
        }}
      >
        <label className={styles.field}>
          商品コード
          <input
            value={code}
            onChange={(event) => onCodeChange(event.target.value)}
            inputMode="numeric"
            autoComplete="off"
          />
        </label>
        <button type="submit" className={styles.secondaryButton}>
          照会
        </button>
      </form>
      {product && (
        <p aria-label="照会結果" className={styles.lookupResult}>
          <span>{product.name}</span>
          <span>{formatYen(product.unit_price)}</span>
        </p>
      )}
      <button type="button" className={styles.primaryButton} onClick={onAdd} disabled={product === null}>
        追加
      </button>
    </section>
  );
}
