import { useId, useState } from "react";
import { Check, ChevronDown, CreditCard } from "lucide-react";
import { normalizeApiOrigin } from "../shared/runtime-config";
import { tx } from "../shared/i18n";
import type { Row } from "../shared/api";

export function paymentIconUrl(source: unknown) {
    const url = typeof source === "string" ? source.trim() : "";
    return /^\/payment-icons\/[a-z0-9-]+\.(svg|png)$/.test(url)
        ? normalizeApiOrigin(window.V2BOARD?.apiBaseUrl || "") + url : url;
}
function PaymentIcon({ source }: { source: unknown }) {
    const [failed, setFailed] = useState(false);
    const url = paymentIconUrl(source);
    return !url || failed ? <CreditCard className="payment-method-icon" size={28} aria-hidden="true" />
        : <img className="payment-method-icon" src={url} alt="" referrerPolicy="no-referrer" onError={() => setFailed(true)} />;
}
export function paymentGroups(methods: Row[]) {
    const groups: { key: string; crypto: boolean; methods: Row[] }[] = [];
    for (const method of methods) {
        const crypto = method.category === "crypto" && Boolean(method.asset && method.network);
        const key = crypto ? `crypto:${method.asset}` : `method:${method.id}`;
        let group = groups.find(item => item.key === key);
        if (!group) { group = { key, crypto, methods: [] }; groups.push(group); }
        group.methods.push(method);
    }
    return groups;
}
export function PaymentMethodPicker({ methods, selected, disabled, onSelect }: {
    methods: Row[]; selected: number; disabled: boolean; onSelect: (id: number) => void;
}) {
    const prefix = useId();
    const groups = paymentGroups(methods);
    const [expanded, setExpanded] = useState<string>();
    const selectedGroup = groups.find(group => group.methods.some(item => Number(item.id) === selected));
    const open = expanded ?? (selectedGroup?.crypto ? selectedGroup.key : "");
    const option = (item: Row, crypto = false, showChannel = false) => {
        const networkName = String(item.network_name || item.network || "");
        const networkParts = networkName.match(/^(.*?)\s*\((TRC20|BEP20|ERC20)\)$/i);
        return <label key={item.id} className={[selected === Number(item.id) ? "selected" : "", crypto ? "payment-network-option" : ""].filter(Boolean).join(" ")}>
        <input type="radio" name={`${prefix}-payment-method`} checked={selected === Number(item.id)} onChange={() => onSelect(Number(item.id))} />
        <PaymentIcon key={String(crypto ? item.network_icon : item.icon)} source={crypto ? item.network_icon : item.icon} />
        <span className="payment-option-copy"><span className="payment-option-title">{crypto ? networkParts?.[1] || networkName : item.name}
            {crypto && networkParts && <span className="payment-network-tag">{networkParts[2]}</span>}
        </span>
            {showChannel && <span className="payment-channel-name">{item.name}</span>}
        </span>
    </label>;
    };
    return <fieldset className="payment-options" disabled={disabled}>
        <legend className="sr-only">{tx("选择支付方式")}</legend>
        {groups.map((group, index) => {
            if (!group.crypto) return option(group.methods[0]);
            const active = group.methods.find(item => Number(item.id) === selected);
            const first = active || group.methods[0];
            const isOpen = open === group.key;
            return <div className={`payment-crypto-group${active ? " has-selection" : ""}`} key={group.key}>
                <button type="button" disabled={disabled} className="payment-crypto-heading" aria-expanded={isOpen} aria-controls={`${prefix}-${index}`} onClick={() => {
                    setExpanded(isOpen ? "" : group.key);
                    if (!isOpen && !active) onSelect(group.methods.length === 1 ? Number(first.id) : 0);
                }}>
                    <span className="payment-selection-slot" aria-hidden="true">{active && !isOpen && <Check size={16} />}</span>
                    <PaymentIcon key={String(first.icon || first.asset_icon)} source={first.icon || first.asset_icon} />
                    <span className="payment-option-copy"><span>{first.asset}{active && ` · ${active.network_name || active.network}`}</span></span>
                    <ChevronDown size={18} className={isOpen ? "expanded" : ""} aria-hidden="true" />
                </button>
                <div id={`${prefix}-${index}`} className="payment-network-options" hidden={!isOpen}>
                    {isOpen && !active && <p className="payment-network-prompt">{tx("请选择转账网络")}</p>}
                    {group.methods.map(item => option(item, true, group.methods.filter(other => other.network === item.network).length > 1))}
                </div>
            </div>;
        })}
        {selectedGroup?.crypto && <p className="payment-network-notice">{tx("请确认付款钱包的币种与网络和所选渠道一致。")}</p>}
    </fieldset>;
}
