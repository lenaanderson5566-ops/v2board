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
        <Tabs.Root value={tab} onValueChange={setTab} activationMode="manual">
            <Tabs.List className="section-tabs" aria-label="订阅管理视图">
                <Tabs.Trigger value="plans">订阅套餐</Tabs.Trigger>
                <Tabs.Trigger value="translations">订阅多语言</Tabs.Trigger>
                <Tabs.Trigger value="currencies">价格与币种</Tabs.Trigger>
            </Tabs.List>
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
