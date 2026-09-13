// 金額の表示（例：2,915円）
const numberFormat = new Intl.NumberFormat("ja-JP");

export const formatNumber = (value: number): string => numberFormat.format(value);

export const formatYen = (amount: number): string => `${formatNumber(amount)}円`;
