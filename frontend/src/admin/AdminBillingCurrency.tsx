import { useState, type FormEvent } from "react";
import { Coins, RefreshCw, Save, ArrowRightLeft } from "lucide-react";
import { admin, request, money } from "../shared/api";
import { State, useData } from "../shared/ui";
import { adminInstant as formatInstant } from "./admin-log-time";
import { AdminSectionHead, AdminOperationNotice, AdminDetails } from "./admin-section";
import { useAdminOperation } from "./admin-operation";
import { AdminChoiceGroup } from "./AdminChoices";
import { parseUsdPrice } from "./billing-price-input";
import { adminPlanOptions } from "./admin-plan-reference";

const periods = {
    month_price: "月付",
    quarter_price: "季付",
    half_year_price: "半年",
    year_price: "年付",
    two_year_price: "两年",
    three_year_price: "三年",
    onetime_price: "额度包",
    reset_price: "流量重置",
} as const;
type Period = keyof typeof periods;
const periodKeys = Object.keys(periods) as Period[];
const currencies = [
    { value: "CNY", label: "人民币（CNY）" },
    { value: "USD", label: "美元（USD）" },
] as const;
type Currency = (typeof currencies)[number]["value"];
type PlanPrices = {
    id: number;
    name: string;
    usd_prices: Partial<Record<Period, number | null>> | null;
};
type CurrencySettings = {
    default_currency: Currency;
    rate: {
        usd_cny_micros: number | null;
        quoted_at: number | null;
        fetched_at: number | null;
        last_error: string | null;
    };
    plans: PlanPrices[];
    paid_totals: { currency: string; amount: number }[];
};
const dateLabel = (timestamp: number | null | undefined) =>
    timestamp ? formatInstant(timestamp) : "—";

function editableUsdPrice(plan: PlanPrices | undefined, key: Period) {
    const cents = plan?.usd_prices?.[key];
    return cents == null ? "" : String(cents / 100);
}

export function AdminBillingCurrency() {
    const data = useData<CurrencySettings>(admin("billing-currency/fetch"));
    const settings = data.data;
    const [currencyDraft, setCurrencyDraft] = useState<Currency | null>(null);
    const [confirmedCurrency, setConfirmedCurrency] = useState<{
        source: CurrencySettings;
        value: Currency;
    } | null>(null);
    const [selectedId, setSelectedId] = useState("");
    const [values, setValues] = useState<Partial<Record<Period, string>>>({});
    const operation = useAdminOperation();
    // Use the successful write while the previous fetch remains on screen.
    const savedCurrency = confirmedCurrency && confirmedCurrency.source === settings
        ? confirmedCurrency.value
        : settings?.default_currency;
    const currencyDirty = currencyDraft !== null && currencyDraft !== savedCurrency;
    const selected = settings?.plans.find(
        (plan) => String(plan.id) === selectedId,
    );
    const pricesDirty = selected && periodKeys.some(
        (key) => (values[key] ?? "") !== editableUsdPrice(selected, key),
    );
    const blocked = operation.busy || data.loading || !!data.error;
    const rate = settings?.rate;

    function saveCurrency(event: FormEvent) {
        event.preventDefault();
        if (!settings || !savedCurrency || !currencyDraft || !currencyDirty || blocked) return;
        if (!window.confirm(`确认将新用户默认币种从 ${savedCurrency} 改为 ${currencyDraft}？变更仅对之后注册的账户生效。`)) return;

        void operation.run(async () => {
            await request(admin("config/save"), { new_user_currency: currencyDraft });
            setConfirmedCurrency({ source: settings, value: currencyDraft });
            setCurrencyDraft(null);
            data.reload();
            return `新用户默认币种已设为 ${currencyDraft}。`;
        });
    }

    function selectPlan(id: string) {
        if (id === selectedId || blocked) return;
        if (pricesDirty && !window.confirm("当前套餐的美元价格尚未保存，确认切换套餐？")) return;
        const plan = settings?.plans.find((item) => String(item.id) === id);
        setSelectedId(id);
        setValues(
            Object.fromEntries(
                periodKeys.map((key) => [key, editableUsdPrice(plan, key)]),
            ),
        );
        operation.clear();
    }

    function savePrices(event: FormEvent) {
        event.preventDefault();
        if (!selected || blocked) return;
        void operation.run(async () => {
            const prices = Object.fromEntries(
                periodKeys.map((key) => [
                    key,
                    parseUsdPrice(values[key] ?? ""),
                ]),
            );
            await request(admin("billing-currency/prices"), {
                plan_id: selected.id,
                prices,
            });
            setSelectedId("");
            setValues({});
            data.reload();
            return "美元价格已保存。";
        });
    }

    return (
        <section className="admin-commerce-page" data-saving={operation.busy || undefined}>
            <AdminSectionHead
                icon={<Coins size={23} />}
                title="价格与币种"
                description="老用户保留人民币，新用户按注册时的默认币种固定。美元价格独立设置，余额不跨币种兑换。"
            />
            <AdminOperationNotice notice={operation.notice} />
            <State {...data} retry={data.reload}>
                {savedCurrency && (
                    <section className="panel">
                        <div className="panel-head">
                            <h2>新用户默认币种</h2>
                        </div>
                        <form
                            className="pad admin-commerce-form"
                            onSubmit={saveCurrency}
                            data-unsaved={currencyDirty || undefined}
                        >
                            <p className="muted">
                                当前默认币种为 <strong>{savedCurrency}</strong>。新用户注册时采用此币种，创建账户后币种固定。
                            </p>
                            <AdminChoiceGroup
                                label="新用户默认币种"
                                options={currencies}
                                value={currencyDraft ?? savedCurrency}
                                disabled={blocked}
                                onChange={(value) => {
                                    setCurrencyDraft(value === savedCurrency ? null : value);
                                    operation.clear();
                                }}
                            />
                            <div className="actions">
                                <button className="primary" disabled={blocked || !currencyDirty}>
                                    <Save size={16} aria-hidden="true" />
                                    保存默认币种
                                </button>
                            </div>
                        </form>
                    </section>
                )}
                <div className="admin-metric-grid">
                    {settings?.paid_totals.map((row) => (
                        <div className="admin-metric" key={row.currency}>
                            <span>已确认订单 · {row.currency}</span>
                            <strong>{money(row.amount, row.currency)}</strong>
                            <small>按币种独立统计</small>
                        </div>
                    ))}
                </div>
                <div className="admin-commerce-grid">
                    <section className="panel admin-currency-rate">
                        <div className="panel-head">
                            <h2>
                                <ArrowRightLeft size={18} aria-hidden="true" />{" "}
                                付款换算汇率
                            </h2>
                        </div>
                        <div className="pad">
                            <p className="admin-rate-value">
                                {rate?.usd_cny_micros
                                    ? `1 USD = ${rate.usd_cny_micros / 1_000_000} CNY`
                                    : "尚未获取汇率"}
                            </p>
                            <AdminDetails items={[
                                {label: "数据时间", value: dateLabel(rate?.quoted_at)},
                                {label: "最近成功", value: dateLabel(rate?.fetched_at)},
                            ]} />
                            <p className="muted">
                                每个 UTC
                                日期最多自动请求一次，手动刷新间隔至少一分钟。报价超过
                                7 天停止新的跨币种付款，历史付款金额保持不变。
                            </p>
                            {rate?.last_error && (
                                <AdminOperationNotice
                                    notice={{
                                        kind: "error",
                                        message:
                                            "最近刷新失败，请检查服务器外网连接。",
                                    }}
                                />
                            )}
                            <div className="actions">
                                <button
                                    type="button"
                                    disabled={blocked}
                                    onClick={() =>
                                        void operation.run(async () => {
                                            const result = await request<{
                                                message?: string;
                                                refreshed: boolean;
                                            }>(
                                                admin(
                                                    "billing-currency/refresh",
                                                ),
                                                {},
                                            );
                                            data.reload();
                                            if (!result.data.refreshed)
                                                throw new Error(
                                                    result.data.message ||
                                                        "Refresh unavailable",
                                                );
                                            return (
                                                result.data?.message ||
                                                "汇率已刷新。"
                                            );
                                        })
                                    }
                                >
                                    <RefreshCw size={16} aria-hidden="true" />{" "}
                                    刷新汇率
                                </button>
                            </div>
                            <a
                                className="admin-source-link"
                                href="https://www.exchangerate-api.com"
                                target="_blank"
                                rel="noreferrer"
                            >
                                Rates By Exchange Rate API ↗
                            </a>
                        </div>
                    </section>
                    <section className="panel">
                        <div className="panel-head">
                            <h2>美元价格</h2>
                        </div>
                        <form
                            className="pad admin-commerce-form"
                            onSubmit={savePrices}
                            aria-busy={operation.busy}
                            data-unsaved={pricesDirty || undefined}
                        >
                            <label>
                                选择套餐
                                <select
                                    value={selectedId}
                                    disabled={blocked}
                                    onChange={(event) =>
                                        selectPlan(event.target.value)
                                    }
                                >
                                    <option value="">请选择套餐</option>
                                    {adminPlanOptions(data.data?.plans || [], selectedId, { data: data.data?.plans, loading: data.loading, error: data.error }).map(([id, name]) => (
                                        <option key={id} value={id}>
                                            {name}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            {selected ? (
                                <>
                                    <p className="muted">
                                        金额单位为美元，留空表示该周期不售卖。
                                    </p>
                                    <fieldset
                                        disabled={blocked}
                                        className="admin-price-fields"
                                    >
                                        <legend className="sr-only">
                                            {selected.name}美元价格
                                        </legend>
                                        {periodKeys.map((key) => (
                                            <label key={key}>
                                                {periods[key]}（USD）
                                                <input
                                                    type="text"
                                                    inputMode="decimal"
                                                    value={values[key] ?? ""}
                                                    onChange={(event) =>
                                                        setValues(
                                                            (previous) => ({
                                                                ...previous,
                                                                [key]: event
                                                                    .target
                                                                    .value,
                                                            }),
                                                        )
                                                    }
                                                    placeholder="不售卖"
                                                />
                                            </label>
                                        ))}
                                    </fieldset>
                                    <div className="actions">
                                        <button
                                            className="primary"
                                            disabled={blocked}
                                        >
                                            <Save
                                                size={16}
                                                aria-hidden="true"
                                            />
                                            {operation.busy
                                                ? "正在处理…"
                                                : "保存美元价格"}
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <div className="admin-inline-empty">
                                    <Coins size={26} aria-hidden="true" />
                                    <p>选择套餐后设置各周期的美元价格。</p>
                                </div>
                            )}
                        </form>
                    </section>
                </div>
            </State>
        </section>
    );
}
