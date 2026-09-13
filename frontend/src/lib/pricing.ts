// 金額計算（design.md 6.1）。バックエンドの PricingService と同じ規則で計算し、画面表示と照合用に使う
// 正とする計算はバックエンド。フロントは期間判定をせず、GET /settings が返す有効な企画をそのまま使う（design.md 7.3）

export type CartLine = {
  code: string;
  name: string;
  unitPrice: number;
  qty: number;
};

export type DiscountCampaign = {
  campaign_id: number;
  name: string;
  product_code: string;
  discount_type: "percent" | "amount";
  discount_value: number;
};

export type Totals = {
  subtotal: number;
  discountTotal: number;
  taxAmount: number;
  total: number;
};

// 整数除算（切り捨て）。値はすべて 0 以上の整数
const div = (a: number, b: number): number => Math.floor(a / b);

const discountFor = (line: CartLine, campaign: DiscountCampaign): number => {
  if (campaign.discount_type === "percent") {
    // 単価に対して切り捨ててから数量を掛ける
    return div(line.unitPrice * campaign.discount_value, 100) * line.qty;
  }
  // 金額値引きは単価で頭打ちにし、明細が負にならないようにする
  return Math.min(campaign.discount_value, line.unitPrice) * line.qty;
};

/** 明細の値引き額（数量分の合計）。複数の企画が重なる場合は値引き額が大きい方を1つだけ適用する */
export const calcLineDiscount = (
  line: CartLine,
  memberId: string | null,
  campaigns: readonly DiscountCampaign[],
): number => {
  if (memberId === null) {
    return 0;
  }
  return campaigns
    .filter((campaign) => campaign.product_code === line.code)
    .reduce((max, campaign) => Math.max(max, discountFor(line, campaign)), 0);
};

export const calcTotals = (
  items: readonly CartLine[],
  memberId: string | null,
  campaigns: readonly DiscountCampaign[],
  taxRateBp: number,
): Totals => {
  const subtotal = items.reduce((sum, line) => sum + line.unitPrice * line.qty, 0);
  const discountTotal = items.reduce(
    (sum, line) => sum + calcLineDiscount(line, memberId, campaigns),
    0,
  );
  // 値引き後に課税し、税額の端数は取引全体で1回だけ切り捨てる（BR-02）
  const taxable = subtotal - discountTotal;
  const taxAmount = div(taxable * taxRateBp, 10000);
  return { subtotal, discountTotal, taxAmount, total: taxable + taxAmount };
};
