import { money } from "../shared/api";
import { formatNumber, formatPercent } from "../shared/number-format";
import { Panel } from "../shared/ui";
import { adminBusinessInstant } from "./admin-log-time";
import { ReportTable } from "./ReportTable";

export type FirstPurchaseData = { available: false } | {
    available: true;
    from: string;
    to: string;
    windowDays: number;
    registered: number;
    paidRecurringAccounts: number;
    paidRecurringRate: number | null;
    funding: { externalOnly: number; mixed: number; walletOnly: number; manual: number; unclassified: number };
    zeroValueRecurringAccounts: number;
    creditOnlyRecurringAccounts: number;
    otherPurchases: { depositAccounts: number; independentCreditAccounts: number; resetAccounts: number; legacyOneTimeAccounts: number };
};

type ReceiptKind = "recurring" | "deposit" | "independentCredits" | "reset" | "legacyOneTime" | "other";
export type ReceiptData = { available: false } | {
    available: true;
    from: string;
    to: string;
    complete: boolean;
    byCurrency: { currency: "CNY" | "USD"; grossAmount: number; orders: number; kinds: { kind: ReceiptKind; grossAmount: number; orders: number }[] }[];
    unresolvedExternalOrders: number;
    manualOrders: number;
    walletOnlyOrders: number;
    zeroExternalOrders: number;
    refundAmount: null;
    providerFeeAmount: null;
    netAmount: null;
    settlementAmount: null;
};

const count = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });
const kinds: Record<ReceiptKind, string> = {
    recurring: "周期套餐", deposit: "账户充值", independentCredits: "独立额度包",
    reset: "流量重置", legacyOneTime: "历史一次性套餐", other: "其他订单",
};

export function FirstPurchaseReport({ firstPurchase, receipts, timeZone }: {
    firstPurchase?: FirstPurchaseData;
    receipts?: ReceiptData;
    timeZone: string;
}) {
    return <>
        <Panel padded title="周期套餐首购 · 7 天观察窗">
            {!firstPurchase?.available ? <p role="status">首购统计暂不可用，请刷新报表或更新服务端。</p> : <>
                <p className="muted">注册区间：{adminBusinessInstant(firstPurchase.from, {}, timeZone)} 至 {adminBusinessInstant(firstPurchase.to, {}, timeZone)}（不含结束时刻）。仅统计已有完整 {firstPurchase.windowDays} 天观察期的非管理员账户。</p>
                <div className="analytics-metrics">
                    <div><small>成熟注册用户</small><strong>{count(firstPurchase.registered)}</strong></div>
                    <div><small>7 天内有价周期套餐首购</small><strong>{count(firstPurchase.paidRecurringAccounts)}</strong></div>
                    <div><small>有价首购确认率</small><strong>{formatPercent(firstPurchase.paidRecurringRate, { fraction: true, bounded: true })}</strong></div>
                </div>
                <p className="muted">有价首购以周期套餐订单的外部应付额与余额抵扣之和大于零为准，按账户首次付款时间去重；包含余额及人工确认，不能直接视为现金首购率。充值、独立额度包、流量重置和一次性套餐不计入。</p>
                <ReportTable headers={["首次有价套餐的付款来源", "用户数"]} rows={[
                    ["仅外部付款（有回调确认号）", count(firstPurchase.funding.externalOnly)],
                    ["外部付款与余额混合", count(firstPurchase.funding.mixed)],
                    ["仅余额支付", count(firstPurchase.funding.walletOnly)],
                    ["人工确认", count(firstPurchase.funding.manual)],
                    ["来源无法核实", count(firstPurchase.funding.unclassified)],
                ]} />
                <p className="muted">同期确认的零价周期套餐用户：{count(firstPurchase.zeroValueRecurringAccounts)}；仅折抵权益开通的周期套餐用户：{count(firstPurchase.creditOnlyRecurringAccounts)}。这些是独立诊断人数，可与首购用户重叠，不相加作为漏斗。</p>
                <details><summary>其他订单类型（7 天内按用户去重）</summary>
                    <ReportTable headers={["订单类型", "确认付款用户数"]} rows={[
                        ["账户充值", count(firstPurchase.otherPurchases.depositAccounts)],
                        ["独立额度包", count(firstPurchase.otherPurchases.independentCreditAccounts)],
                        ["流量重置", count(firstPurchase.otherPurchases.resetAccounts)],
                        ["历史一次性套餐", count(firstPurchase.otherPurchases.legacyOneTimeAccounts)],
                    ]} />
                </details>
            </>}
        </Panel>
        <Panel padded title="外部订单回调确认金额">
            {!receipts?.available ? <p role="status">外部收款记录暂不可用，请刷新报表或更新服务端。</p> : <>
                <p className="muted">付款区间：{adminBusinessInstant(receipts.from, {}, timeZone)} 至 {adminBusinessInstant(receipts.to, {}, timeZone)}。这是所选时间范围内的订单记录，与上方注册批次不同。</p>
                {!receipts.complete && <p className="alert" role="status">有 {count(receipts.unresolvedExternalOrders)} 笔外部订单缺少可核实的收款快照，未计入下方确认金额；当前金额并非完整回款。</p>}
                <ReportTable headers={["收款币种", "回调确认金额", "订单数"]} rows={receipts.byCurrency.map(row => [row.currency, money(row.grossAmount, row.currency), count(row.orders)])} />
                <p className="muted">仅汇总带回调确认号和有效收款快照的外部付款，使用快照的收款币种和金额，可能包含向用户收取的手续费。充值只在外部付款时计入；后续余额消费不重复计入。不同币种分别展示，不自动换算或相加。</p>
                <details><summary>按订单类型查看确认金额</summary>
                    <ReportTable headers={["收款币种", "订单类型", "回调确认金额", "订单数"]} rows={receipts.byCurrency.flatMap(row => row.kinds.map(kind => [row.currency, kinds[kind.kind], money(kind.grossAmount, row.currency), count(kind.orders)]))} />
                </details>
                <p className="muted">另列未计入外部金额的订单：人工确认 {count(receipts.manualOrders)} 笔、仅余额支付 {count(receipts.walletOnlyOrders)} 笔、零外部应付 {count(receipts.zeroExternalOrders)} 笔。分类不是实际扣款或银行入账证明。</p>
                <p className="muted">退款、服务商手续费、净收入与服务商结算金额：不可计算。当前没有完整的对应台账；套餐折抵退回余额不等于服务商退款。</p>
            </>}
        </Panel>
    </>;
}
