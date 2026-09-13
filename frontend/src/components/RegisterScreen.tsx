"use client";

// レジ画面（requirements.md 5.3 SR-002）。業務フロー順に上から下へ配置する
// 金額は画面表示と照合用に calcTotals で計算し、確定時はバックエンドの再計算を正とする（design.md 7.3）
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { BarcodeScanner } from "@/components/BarcodeScanner";
import { CartList } from "@/components/CartList";
import { CompletionDialog } from "@/components/CompletionDialog";
import { MemberPanel } from "@/components/MemberPanel";
import { ProductEntry } from "@/components/ProductEntry";
import { SelectedLinePanel } from "@/components/SelectedLinePanel";
import { StaffBar } from "@/components/StaffBar";
import { TotalsPanel } from "@/components/TotalsPanel";
import { api, type ApiResult, type Member, type Settings, type StaffIdentity } from "@/lib/api";
import {
  QUANTITY_MAX,
  QUANTITY_MIN,
  cartReducer,
  initialCartState,
  type CartAction,
  type CartState,
  type Product,
} from "@/lib/cartReducer";
import { classifyCode } from "@/lib/classifyCode";
import { purchaseFingerprint, reuseOrCreateKey, type PendingKey } from "@/lib/idempotencyKey";
import { CLIENT_MESSAGES, messageForError } from "@/lib/messages";
import { calcTotals } from "@/lib/pricing";

import styles from "./RegisterScreen.module.css";

const TOAST_MS = 2000;

type Failure = Exclude<ApiResult<unknown>, { kind: "ok" }>;

type Props = {
  staff: StaffIdentity | null;
  // 冪等キーの生成。テストで差し替える
  generateKey?: () => string;
};

export function RegisterScreen({ staff, generateKey = () => crypto.randomUUID() }: Props) {
  const router = useRouter();
  const [cart, setCart] = useState<CartState>(initialCartState);
  // 連続スキャンで非同期の結果が続けて届いても取りこぼさないよう、最新の状態を同期的に持つ
  const cartRef = useRef<CartState>(initialCartState);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [memberInput, setMemberInput] = useState("");
  const [productCode, setProductCode] = useState("");
  const [foundProduct, setFoundProduct] = useState<Product | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [completedTotal, setCompletedTotal] = useState<number | null>(null);
  const [purchasing, setPurchasing] = useState(false);
  const pendingKeyRef = useRef<PendingKey | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const dispatch = (action: CartAction): CartState => {
    const next = cartReducer(cartRef.current, action);
    cartRef.current = next;
    setCart(next);
    return next;
  };

  // 失敗の表示。401 は BFF が更新を試みたうえでの失敗なので、ログイン画面へ移す
  const handleFailure = (result: Failure, validationMessage?: string) => {
    if (result.kind === "network") {
      setNotice(CLIENT_MESSAGES.NETWORK);
    } else if (result.status === 401) {
      router.replace("/login");
    } else if (result.code === "VALIDATION_ERROR" && validationMessage) {
      setNotice(validationMessage);
    } else {
      setNotice(messageForError(result.code));
    }
  };

  // 税率と値引き企画は画面を開いたときに取得して保持する（design.md 3.2.2）
  useEffect(() => {
    void api.getSettings().then((result) => {
      if (result.kind === "ok") {
        setSettings(result.data);
      } else {
        handleFailure(result);
      }
    });
    return () => clearTimeout(toastTimerRef.current);
    // 画面を開いたときに1回だけ
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_MS);
  };

  const addProduct = (product: Product): boolean => {
    const next = dispatch({ type: "ADD_PRODUCT", product });
    if (next.error !== null) {
      setNotice(next.error === "QUANTITY_LIMIT" ? CLIENT_MESSAGES.QUANTITY_LIMIT : CLIENT_MESSAGES.LINE_LIMIT);
      return false;
    }
    setNotice(null);
    showToast(CLIENT_MESSAGES.ADDED);
    return true;
  };

  const fetchProduct = async (code: string): Promise<Product | null> => {
    const result = await api.getProduct(code);
    if (result.kind === "ok") {
      return { product_code: result.data.product_code, name: result.data.name, unit_price: result.data.unit_price };
    }
    handleFailure(result, CLIENT_MESSAGES.INVALID_PRODUCT_CODE);
    return null;
  };

  const loadMember = async (memberId: string) => {
    const result = await api.getMember(memberId);
    if (result.kind !== "ok") {
      handleFailure(result, CLIENT_MESSAGES.INVALID_MEMBER_ID);
      return;
    }
    // 電話番号・住所は保持しない（NFR-SEC-09）
    setMember({ member_id: result.data.member_id, name: result.data.name });
    setMemberInput(result.data.member_id);
    dispatch({ type: "SET_MEMBER", memberId: result.data.member_id });
    setNotice(null);
  };

  // スキャンは1段階：会員IDなら会員を読み込み、商品コードならそのまま購入リストに追加する
  const onScan = async (raw: string) => {
    const code = raw.trim();
    const kind = classifyCode(code);
    if (kind === "member") {
      await loadMember(code);
    } else if (kind === "product") {
      const product = await fetchProduct(code);
      if (product) {
        addProduct(product);
      }
    } else {
      setNotice(CLIENT_MESSAGES.INVALID_SCAN);
    }
  };

  const onMemberLookup = async () => {
    const code = memberInput.trim();
    if (classifyCode(code) !== "member") {
      setNotice(CLIENT_MESSAGES.INVALID_MEMBER_ID);
      return;
    }
    await loadMember(code);
  };

  const onNoMember = () => {
    setMember(null);
    setMemberInput("");
    dispatch({ type: "SET_MEMBER", memberId: null });
    setNotice(null);
  };

  const onProductCodeChange = (value: string) => {
    setProductCode(value);
    setFoundProduct(null);
  };

  // 手入力は2段階：照会で名称・単価を表示し、追加ボタンで購入リストに入れる
  const onProductLookup = async () => {
    const code = productCode.trim();
    if (classifyCode(code) !== "product") {
      setNotice(CLIENT_MESSAGES.INVALID_PRODUCT_CODE);
      return;
    }
    const product = await fetchProduct(code);
    if (product) {
      setFoundProduct(product);
      setNotice(null);
    }
  };

  const onProductAdd = () => {
    if (foundProduct && addProduct(foundProduct)) {
      // 追加後は入力欄・名称・単価の表示をクリアする（FR-006）
      setProductCode("");
      setFoundProduct(null);
    }
  };

  const onChangeQuantity = (qty: number) => {
    if (!Number.isInteger(qty) || qty < QUANTITY_MIN || qty > QUANTITY_MAX) {
      setNotice(CLIENT_MESSAGES.QUANTITY_RANGE);
      return;
    }
    dispatch({ type: "SET_QUANTITY", qty });
    setNotice(null);
  };

  const onRemove = () => {
    dispatch({ type: "REMOVE_SELECTED" });
    setNotice(null);
  };

  const canPurchase = settings !== null && cart.lines.length > 0 && !purchasing;

  const onPurchase = async () => {
    const current = cartRef.current;
    if (settings === null || current.lines.length === 0) {
      return;
    }
    // 購入リストと会員が前回の購入操作から変わっていなければ、同じ冪等キーで再送する
    const pending = reuseOrCreateKey(
      pendingKeyRef.current,
      purchaseFingerprint(current.memberId, current.lines),
      generateKey,
    );
    pendingKeyRef.current = pending;
    const totals = calcTotals(current.lines, current.memberId, settings.campaigns, settings.tax_rate_bp);

    setPurchasing(true);
    const result = await api.postTransaction({
      idempotency_key: pending.key,
      member_id: current.memberId,
      items: current.lines.map((line) => ({ product_code: line.code, quantity: line.qty })),
      client_totals: {
        subtotal: totals.subtotal,
        discount_total: totals.discountTotal,
        tax_amount: totals.taxAmount,
        total: totals.total,
      },
    });
    setPurchasing(false);

    if (result.kind === "ok") {
      setCompletedTotal(result.data.total);
      setNotice(null);
    } else if (result.kind === "error" && result.code === "DUPLICATE") {
      // 同じ冪等キーの取引は保存済み。完了扱いにする（design.md 6.2）
      setCompletedTotal(totals.total);
      setNotice(null);
    } else {
      handleFailure(result, CLIENT_MESSAGES.INVALID_PURCHASE);
    }
  };

  // ポップアップを閉じたら、次の客の会計に向けて画面をクリアする（FR-011）
  const onCloseCompletion = () => {
    setCompletedTotal(null);
    dispatch({ type: "RESET" });
    setMember(null);
    setMemberInput("");
    setProductCode("");
    setFoundProduct(null);
    setNotice(null);
    pendingKeyRef.current = null;
  };

  const onLogout = async () => {
    await api.logout();
    router.replace("/login");
  };

  const selectedLine = cart.lines.find((line) => line.code === cart.selectedCode) ?? null;
  const totals = settings
    ? calcTotals(cart.lines, cart.memberId, settings.campaigns, settings.tax_rate_bp)
    : null;

  return (
    <div className={styles.screen}>
      <StaffBar staff={staff} onLogout={onLogout} />
      <main className={styles.main}>
        <BarcodeScanner onDetect={onScan} />
        <MemberPanel
          member={member}
          memberInput={memberInput}
          onMemberInputChange={setMemberInput}
          onLookup={onMemberLookup}
          onNoMember={onNoMember}
        />
        <ProductEntry
          code={productCode}
          product={foundProduct}
          onCodeChange={onProductCodeChange}
          onLookup={onProductLookup}
          onAdd={onProductAdd}
        />
        {notice && (
          <p role="alert" className={styles.notice}>
            {notice}
          </p>
        )}
        <CartList
          lines={cart.lines}
          memberId={cart.memberId}
          campaigns={settings?.campaigns ?? []}
          selectedCode={cart.selectedCode}
          onSelect={(code) => dispatch({ type: "SELECT_LINE", code })}
        />
        <SelectedLinePanel
          key={selectedLine?.code ?? "none"}
          line={selectedLine}
          onChangeQuantity={onChangeQuantity}
          onRemove={onRemove}
        />
        <TotalsPanel totals={totals} />
        <button type="button" className={styles.purchaseButton} onClick={onPurchase} disabled={!canPurchase}>
          購入
        </button>
      </main>
      {toast && (
        <div role="status" className={styles.toast}>
          {toast}
        </div>
      )}
      {completedTotal !== null && <CompletionDialog total={completedTotal} onClose={onCloseCompletion} />}
    </div>
  );
}
