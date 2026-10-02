import i18n, { languages } from "./i18n";
const copy = {
    annual: [
        "折合 {{price}} / 月，按年一次支付",
        "折合 {{price}} / 月，按年一次支付",
        "Equivalent to {{price}} / month, billed annually",
        "月額換算 {{price}}、年額一括払い",
        "월 환산 {{price}}, 연간 일시 결제",
        "Tương đương {{price}} / tháng, thanh toán theo năm",
        "Эквивалент {{price}} / мес., оплата за год",
        "معادل {{price}} در ماه، پرداخت سالانه",
    ],
    total: [
        "按所选周期一次支付",
        "按所選週期一次支付",
        "One payment for the selected period",
        "選択した期間の一括払い",
        "선택한 기간 요금 일시 결제",
        "Thanh toán một lần cho kỳ đã chọn",
        "Разовая оплата выбранного периода",
        "پرداخت یکجای دوره انتخاب‌شده",
    ],
    save: [
        "比逐月支付节省 {{percent}}%",
        "比逐月支付節省 {{percent}}%",
        "Save {{percent}}% vs. monthly payments",
        "月払い比 {{percent}}% お得",
        "매월 결제 대비 {{percent}}% 절약",
        "Tiết kiệm {{percent}}% so với trả hàng tháng",
        "На {{percent}}% дешевле ежемесячной оплаты",
        "{{percent}}٪ صرفه‌جویی نسبت به پرداخت ماهانه",
    ],
    fallback: [
        "此套餐提供{{period}}，可查看其他周期",
        "此套餐提供{{period}}，可查看其他週期",
        "Available: {{period}}. View other periods at checkout.",
        "{{period}}に対応。他の期間は購入時に確認できます。",
        "{{period}} 가능. 결제 시 다른 기간을 확인하세요.",
        "Có kỳ {{period}}. Xem kỳ khác khi thanh toán.",
        "Доступно: {{period}}. Другие периоды — при оформлении.",
        "موجود: {{period}}. دوره‌های دیگر را هنگام خرید ببینید.",
    ],
};
languages.forEach((language, index) =>
    i18n.addResourceBundle(
        language.code,
        "pricing",
        Object.fromEntries(
            Object.entries(copy).map(([key, values]) => [key, values[index]]),
        ),
    ),
);
export const pricingCopy = (
    key: keyof typeof copy,
    args: Record<string, unknown> = {},
): string => String(i18n.t(key, { ns: "pricing", ...args }));
