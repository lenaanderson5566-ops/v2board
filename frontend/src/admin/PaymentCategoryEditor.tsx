import catalog from "../../../resources/payment-catalog.json";
const icons = import.meta.glob("../../../public/payment-icons/crypto-*.svg", { eager: true, query: "?raw", import: "default" });
const iconSource = (id: string) => `data:image/svg+xml,${encodeURIComponent(String(icons[`../../../public/payment-icons/${id}.svg`] || ""))}`;
export type PaymentCategory = { category: "regular" | "crypto"; asset: string; network: string; networkName: string; networkIcon: string };
export function paymentCategoryInitial(config: Record<string, any> = {}): PaymentCategory {
    return { category: "regular", asset: "", network: "", networkName: "", networkIcon: "", ...config._console_checkout };
}
export function PaymentCategoryEditor({ value, onChange }: { value: PaymentCategory; onChange: (value: PaymentCategory) => void }) {
    const update = (patch: Partial<PaymentCategory>) => onChange({ ...value, ...patch });
    const builtinAsset = catalog.assets.some(item => item.id === value.asset);
    const builtinNetwork = catalog.networks.some(item => item.id === value.network);
    return <div className="pad payment-category-settings">
        <label>支付类别<select value={value.category} onChange={event => update({ category: event.target.value as PaymentCategory["category"] })}>
            <option value="regular">常规支付</option><option value="crypto">加密货币</option>
        </select></label>
        {value.category === "crypto" && <>
            <p className="muted">币种和网络必须与支付接口中的渠道配置一致。这里只控制展示与分组，不会开通新的支付网络。</p>
            <label>币种<select value={builtinAsset ? value.asset : "custom"} onChange={event => update({ asset: event.target.value === "custom" ? "" : event.target.value })}>
                {catalog.assets.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">自定义币种</option>
            </select></label>
            {!builtinAsset && <label>币种代码<input value={value.asset} maxLength={20} placeholder="例如 USDT" onChange={event => update({ asset: event.target.value.toUpperCase().trim() })} /></label>}
            <label>转账网络<select value={builtinNetwork ? value.network : "custom"} onChange={event => {
                const network = catalog.networks.find(item => item.id === event.target.value);
                update({ network: network?.id || "", networkName: network?.name || "", networkIcon: "" });
            }}>
                {catalog.networks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}<option value="custom">自定义网络</option>
            </select></label>
            {!builtinNetwork && <>
                <label>网络代码<input value={value.network} maxLength={40} placeholder="例如 arbitrum" onChange={event => update({ network: event.target.value.toLowerCase().trim() })} /></label>
                <label>网络名称<input value={value.networkName} maxLength={80} placeholder="例如 Arbitrum One" onChange={event => update({ networkName: event.target.value })} /></label>
            </>}
            <label>网络图标链接（可选）<input type="url" value={value.networkIcon} onChange={event => update({ networkIcon: event.target.value })} placeholder="https://" /></label>
            <div className="payment-icon-preview">
                <span>币种图标</span><img src={iconSource(catalog.assets.find(item => item.id === value.asset)?.icon || "crypto-generic")} alt={value.asset || "币种"} />
                <span>网络图标</span><img key={value.networkIcon || value.network} src={value.networkIcon || iconSource(catalog.networks.find(item => item.id === value.network)?.icon || "crypto-generic")} alt={value.networkName || "网络"} onError={event => { event.currentTarget.src = iconSource("crypto-generic"); }} />
            </div>
            <p className="muted">默认使用币种和网络的内置图标。支付图标链接覆盖币种图标，网络图标链接覆盖网络图标。</p>
        </>}
    </div>;
}
