import { formatNumber, formatPercent } from "../shared/number-format";
import { Panel } from "../shared/ui";
import { adminBusinessInstant } from "./admin-log-time";

export type DashboardFirstPurchaseData = { available: false } | {
    available: true;
    from: string;
    to: string;
    windowDays: number;
    registered: number;
    funding: { externalOnly: number; mixed: number; walletOnly: number; manual: number; unclassified: number };
    verifiedRecurringAccounts: number;
    verifiedCreditAccounts: number;
};

const count = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

export function DashboardFirstPurchase({ firstPurchase, timeZone }: { firstPurchase?: DashboardFirstPurchaseData; timeZone: string }) {
    const data = firstPurchase?.available ? firstPurchase : null;
    const products = data ? [
        { label: "周期套餐首购", accounts: data.verifiedRecurringAccounts },
        { label: "独立额度包购买", accounts: data.verifiedCreditAccounts },
    ] : [];
    return <Panel padded title="新用户付费转化 · 7 天观察窗">
        {!data ? <p role="status">暂无法读取订单转化，请刷新报表。</p> : <>
            <p className="muted">注册区间 {adminBusinessInstant(data.from, {}, timeZone)} 至 {adminBusinessInstant(data.to, {}, timeZone)}（不含结束时刻）。仅纳入已有完整 {data.windowDays} 天观察期的非管理员注册账户，设备筛选不影响此处。</p>
            <div className="analytics-metrics">
                <div><span>完整观察期注册用户</span><strong>{count(data.registered)}</strong></div>
                {products.map(({ label, accounts }) => <div key={label}>
                    <span>{label}</span>
                    <strong>{formatPercent(data.registered ? accounts / data.registered : null, { fraction: true, bounded: true })}</strong>
                    <small>{count(accounts)} / {count(data.registered)} 个注册账户</small>
                </div>)}
            </div>
            <p className="muted">以有价订单的外部回调或余额扣款为准，人工确认、来源不明、零价开通、充值和流量重置不计入。周期套餐按首笔有价订单判定，首笔人工确认或来源不明时，后续付款不计为首购。独立额度包按窗内至少买过一次去重，两类用户可重叠。</p>
            {(data.funding.manual > 0 || data.funding.unclassified > 0) && <p>另有人工确认首购 {count(data.funding.manual)} 个、付款来源不明首购 {count(data.funding.unclassified)} 个，未纳入转化率。</p>}
            <p><a href="#/orders">在订单管理核对支付与开通状态</a></p>
        </>}
    </Panel>;
}
