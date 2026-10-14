import { AdminCouponPresentation } from "./AdminCouponPresentation";
import { useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Gift, TicketPercent, History, Languages } from "lucide-react";
import { ResourcePage, resources } from "./admin";
import { AdminSectionHead } from "./admin-section";
import { AdminCouponIssue } from "./AdminCouponIssue";
import { AdminCouponCampaigns } from "./AdminCouponCampaigns";

export function AdminCoupons() {
    const [tab, setTab] = useState("templates");
    return (
        <section className="admin-commerce-page">
            <AdminSectionHead
                icon={<TicketPercent size={23} />}
                title="优惠券"
                description="支持用户主动领取与管理员发放，每人每种券限领一次。已发出的券保留领取时的优惠及有效期。"
            />
            <Tabs.Root
                value={tab}
                activationMode="manual"
                onValueChange={setTab}
            >
                <Tabs.List className="section-tabs" aria-label="优惠券管理视图">
                    <Tabs.Trigger value="templates">
                        <TicketPercent size={16} aria-hidden="true" />
                        券模板与活动领取
                    </Tabs.Trigger>
                    <Tabs.Trigger value="presentation">
                        <Languages size={16} aria-hidden="true" />
                        活动与多语言
                    </Tabs.Trigger>
                    <Tabs.Trigger value="issue">
                        <Gift size={16} aria-hidden="true" />
                        发放到用户券包
                    </Tabs.Trigger>
                    <Tabs.Trigger value="records">
                        <History size={16} aria-hidden="true" />
                        发放记录
                    </Tabs.Trigger>
                </Tabs.List>
                <Tabs.Content value="templates">
                    <ResourcePage resource={resources.coupons} />
                </Tabs.Content>
                <Tabs.Content value="presentation">
                    <AdminCouponPresentation />
                </Tabs.Content>
                <Tabs.Content value="issue">
                    <AdminCouponIssue onQueued={() => setTab("records")} />
                </Tabs.Content>
                <Tabs.Content value="records">
                    <AdminCouponCampaigns />
                </Tabs.Content>
            </Tabs.Root>
        </section>
    );
}
