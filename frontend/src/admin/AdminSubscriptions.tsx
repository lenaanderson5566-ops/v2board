import { useState } from "react";
import { ResourcePage, resources, Translations } from "./admin";
export function AdminSubscriptions({
    initialTab = "plans",
}: {
    initialTab?: "plans" | "translations";
}) {
    const [tab, setTab] = useState(initialTab);
    return (
        <>
            <div
                className="section-tabs"
                role="tablist"
                aria-label="订阅管理视图"
            >
                <button
                    role="tab"
                    aria-selected={tab === "plans"}
                    onClick={() => setTab("plans")}
                >
                    订阅套餐
                </button>
                <button
                    role="tab"
                    aria-selected={tab === "translations"}
                    onClick={() => setTab("translations")}
                >
                    订阅多语言
                </button>
            </div>
            {tab === "plans" ? (
                <ResourcePage resource={resources.plans} />
            ) : (
                <Translations />
            )}
        </>
    );
}
