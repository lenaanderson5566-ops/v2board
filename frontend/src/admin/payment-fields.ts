import type { Row } from "../shared/api";
import type { Field } from "../shared/ui";
import { resolvePaymentIcon } from "./payment-icons";
import catalog from "../../../resources/payment-catalog.json";

export function paymentFields(form: Row): Field[] {
    return Object.entries(form)
        .filter(([, v]) => v.type !== "alert")
        .map(([key, v]) => ({
            key: "config." + key,
            label: v.label || key,
            type:
                v.type === "textarea"
                    ? "textarea"
                    : v.type === "select"
                      ? "select"
                      : /secret|password|token|key|sk_live/i.test(key)
                        ? "password"
                        : v.type === "number"
                          ? "number"
                          : "text",
            options: Array.isArray(v.options)
                ? v.options.map((o: any) =>
                      Array.isArray(o)
                          ? [String(o[0]), String(o[1])]
                          : [String(o.value), String(o.label)],
                  )
                : v.options
                  ? Object.entries(v.options).map(([value, label]) => [
                        value,
                        String(label),
                    ])
                  : undefined,
            hint: v.description,
            required: Boolean(v.required),
        }));
}
export function paymentInitial(
    initial: Row,
    form: Row,
    sameMethod: boolean,
): Row {
    return {
        ...initial,
        ...Object.fromEntries(
            Object.entries(form)
                .filter(([, v]) => v.type !== "alert")
                .map(([key, v]) => [
                    "config." + key,
                    sameMethod
                        ? (initial.config?.[key] ?? v.value ?? "")
                        : (v.value ?? ""),
                ]),
        ),
    };
}
export function paymentPayload(
    values: Row,
    form: Row,
    method: string,
    initial: Row,
): Row {
    const config: Row = method === initial.payment ? { ...initial.config } : {};
    Object.entries(form)
        .filter(([, v]) => v.type === "alert")
        .forEach(([key]) => delete config[key]);
    Object.entries(form)
        .filter(([, v]) => v.type !== "alert")
        .forEach(([key]) => {
            config[key] = values["config." + key] ?? "";
        });
    if (values.iconPreset !== undefined) config._console_icon = values.iconPreset;
    if (values.checkoutCategory) {
        const meta = values.checkoutCategory;
        if (meta.category === "crypto" && (!/^[A-Z0-9][A-Z0-9._-]{0,19}$/.test(meta.asset) || !/^[a-z0-9][a-z0-9_-]{0,39}$/.test(meta.network) || !meta.networkName.trim())) {
            throw new Error("请填写有效的币种代码、网络代码和网络名称");
        }
        config._console_checkout = meta.category === "crypto" ? meta : { category: "regular" };
    }
    return {
        ...Object.fromEntries(
            [
                "id",
                "name",
                "icon",
                "notify_domain",
                "handling_fee_fixed",
                "handling_fee_percent",
            ]
                .filter((key) => values[key] !== undefined)
                .map((key) => [key, values[key]]),
        ),
        payment: method,
        ...(values.iconPreset !== undefined
            ? { icon: values.checkoutCategory?.category === "crypto"
                ? String(values.icon || "").trim() || `/payment-icons/${catalog.assets.find(item => item.id === values.checkoutCategory.asset)?.icon || "crypto-generic"}.svg`
                : resolvePaymentIcon(values.icon, values.iconPreset) }
            : {}),
        config,
    };
}
