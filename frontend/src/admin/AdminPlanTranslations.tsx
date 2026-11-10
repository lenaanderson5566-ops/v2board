import { useRef, useState } from "react";
import { admin, rows, type Row } from "../shared/api";
import { Empty, Panel, State, useData } from "../shared/ui";
import { AdminPlanTranslationWorkspace } from "./AdminPlanTranslationWorkspace";
import { adminPlanOptions } from "./admin-plan-reference";

export default function AdminPlanTranslations() {
    const plans = useData<Row[]>(admin("plan/fetch"));
    // Load languages only when this tab is visited, including before a plan is chosen.
    const locales = useData<string[]>(admin("ops/i18n/plan/locales"));
    const [plan, setPlan] = useState(""), [busy, setBusy] = useState(false);
    const root = useRef<HTMLDivElement>(null);
    return (
        <Panel title="套餐翻译">
            <div ref={root}>
            <div className="pad actions">
                <select
                    value={plan}
                    disabled={busy}
                    onChange={(e) => {
                        if (root.current?.querySelector('[data-unsaved="true"]') && !window.confirm("有尚未保存的译文，确认切换套餐？")) return;
                        setPlan(e.target.value);
                    }}
                    aria-label="选择套餐"
                >
                    <option value="">选择套餐</option>
                    {adminPlanOptions(rows(plans.data), plan, plans).map(([id, name]) => (
                        <option key={id} value={id}>
                            {name}
                        </option>
                    ))}
                </select>
            </div>
            <State {...plans}>{null}</State>
            <State {...locales}>{null}</State>
            {plan ? (
                <AdminPlanTranslationWorkspace key={plan} plan={plan} locales={locales.data || undefined} onBusyChange={setBusy} />
            ) : (
                <Empty text="选择套餐后开始翻译" />
            )}
            </div>
        </Panel>
    );
}
