import { AdminTabList } from "./AdminChoices";
import { AdminBillingCurrency } from "./AdminBillingCurrency";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { ResourcePage, resources, Translations } from "./admin";
export function AdminSubscriptions({
    initialTab = "plans",
}: {
    initialTab?: "plans" | "translations";
}) {
    const [tab, setTab] = useState<string>(initialTab);
    return (
        <Tabs.Root className="admin-workspace-tabs" value={tab} onValueChange={next => {
            const root = document.querySelector('.admin-content') || document;
            if (root.querySelector('[data-saving="true"], form[aria-busy="true"]')) return;
            if (root.querySelector('[data-unsaved="true"]') && !window.confirm("有尚未保存的修改，确认离开当前页面？")) return;
            setTab(next);
        }} activationMode="manual">
            <AdminTabList label="套餐管理视图" options={[{value:"plans",label:"套餐列表"},{value:"translations",label:"套餐翻译"},{value:"currencies",label:"价格与币种"}]} />
            <Tabs.Content value="plans">
                <ResourcePage resource={resources.plans} />
            </Tabs.Content>
            <Tabs.Content value="translations">
                <Translations />
            </Tabs.Content>
            <Tabs.Content value="currencies">
                <AdminBillingCurrency />
            </Tabs.Content>
        </Tabs.Root>
    );
}
