import { formatNumber, formatPercent } from "../shared/number-format";
import { Panel } from "../shared/ui";
import { adminBusinessInstant } from "./admin-log-time";

export type DashboardFirstPurchaseData = { available: false } | {
    available: true;
    from: string;
    to: string;
    windowDays: number;
    registered: number;
    verifiedPayingAccounts?: number | null;
    funding: { externalOnly: number; mixed: number; walletOnly: number; manual: number; unclassified: number };
    verifiedRecurringAccounts: number;
    verifiedCreditAccounts: number;
};

const count = (value: number) => formatNumber(value, { maximumFractionDigits: 0 });

export function DashboardFirstPurchase({ firstPurchase, timeZone }: { firstPurchase?: DashboardFirstPurchaseData; timeZone: string }) {
    const data = firstPurchase?.available ? firstPurchase : null;
    const products = data ? [
        { label: "整体付费转化率", accounts: data.verifiedPayingAccounts },
        { label: "周期套餐首购", accounts: data.verifiedRecurringAccounts },
        { label: "独立额度包购买", accounts: data.verifiedCreditAccounts },
    ] : [];
    return <Panel padded title="新用户付费转化 · 7 天观察窗" actions={<a className="button" href="#/orders">查看订单</a>}>
        {!data ? <p role="status">暂无法读取订单转化，请刷新报表。</p> : <>
            <p>完整观察期注册用户 <strong>{count(data.registered)}</strong> 人。按注册后 {data.windowDays} 天内的业务订单统计，购买两类产品的用户在整体转化中只计一次。</p>
            <div className="analytics-metrics">
                {products.map(({ label, accounts }) => <div key={label}>
                    <span>{label}</span>
                    <strong>{formatPercent(data.registered && accounts != null ? accounts / data.registered : null, { fraction: true, bounded: true })}</strong>
                    <small>{accounts == null ? "暂无去重人数" : `${count(accounts)} / ${count(data.registered)} 个注册账户`}</small>
                </div>)}
            </div>
            {data.registered === 0 && <p role="status">该注册区间暂无完成观察期的用户。</p>}
            <p className="muted">注册区间 {adminBusinessInstant(data.from, {}, timeZone)} 至 {adminBusinessInstant(data.to, {}, timeZone)}（不含结束时刻）。</p>
            <details className="analytics-definition">
                <summary>哪些订单计入转化</summary>
                <p>周期套餐取首笔有价订单。首笔人工确认、付款来源不明，或历史订单缺少付款时间而无法确定先后时，该账户的周期首购不计入。独立额度包按窗内至少购买一次统计。</p>
                <p>两类订单均须有渠道回调或余额扣款。零价开通、充值和流量重置均不计入。</p>
                {(data.funding.manual > 0 || data.funding.unclassified > 0) && <p>周期套餐另有人工确认首购 {count(data.funding.manual)} 个、付款来源不明首购 {count(data.funding.unclassified)} 个。</p>}
            </details>
        </>}
    </Panel>;
}
