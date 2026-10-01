import type { Row } from "./api";
import type { Field } from "./ui";

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
        config,
    };
}
