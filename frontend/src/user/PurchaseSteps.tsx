import { tx } from "../shared/i18n";
export function PurchaseSteps({ step }: { step: number }) {
    return (
        <ol className="purchase-steps" aria-label={tx("订阅流程")}>
            {["选择套餐", "确认与支付", "开通完成"].map((label, index) => (
                <li
                    key={label}
                    className={
                        step === index + 1
                            ? "current"
                            : step > index + 1
                              ? "complete"
                              : ""
                    }
                    aria-current={step === index + 1 ? "step" : undefined}
                >
                    <span>{index + 1}</span>
                    {tx(label)}
                </li>
            ))}
        </ol>
    );
}
