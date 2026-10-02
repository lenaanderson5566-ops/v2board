import { Check, X } from "lucide-react";
import { tx } from "./i18n";
import { Html } from "./ui";

type PlanFeature = { feature: string; support: boolean };

export function parsePlanFeatures(content: unknown): PlanFeature[] | null {
    let value = content;
    if (typeof value === "string") {
        try {
            value = JSON.parse(value);
        } catch {
            return null;
        }
    }
    if (!Array.isArray(value)) return null;
    const result: PlanFeature[] = [];
    for (const item of value) {
        if (
            !item ||
            typeof item !== "object" ||
            typeof item.feature !== "string"
        )
            return null;
        const support = item.support;
        if (![true, false, 1, 0, "true", "false", "1", "0"].includes(support))
            return null;
        result.push({
            feature: item.feature,
            support:
                support === true ||
                support === 1 ||
                support === "true" ||
                support === "1",
        });
    }
    return result;
}

export function PlanDescription({ content }: { content: unknown }) {
    const features = parsePlanFeatures(content);
    if (features === null) return <Html value={content} />;
    return (
        <ul className="plan-feature-list">
            {features.map((item, index) => (
                <li
                    key={index}
                    className={item.support ? "included" : "excluded"}
                >
                    <span
                        className="plan-feature-status"
                        role="img"
                        aria-label={tx(item.support ? "支持" : "不支持")}
                    >
                        {item.support ? (
                            <Check size={17} aria-hidden="true" />
                        ) : (
                            <X size={17} aria-hidden="true" />
                        )}
                    </span>
                    <span>{item.feature}</span>
                </li>
            ))}
        </ul>
    );
}
