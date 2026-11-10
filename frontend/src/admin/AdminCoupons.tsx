import { AdminTabList } from "./AdminChoices";
import { AdminCouponPresentation } from "./AdminCouponPresentation";
import { useRef, useState } from "react";
import * as Tabs from "@radix-ui/react-tabs";
import { Gift, TicketPercent, History, Languages } from "lucide-react";
import { ResourcePage } from "./admin";
import { resources } from "./admin-resources";
import { AdminSectionHead } from "./admin-section";
import { AdminCouponIssue } from "./AdminCouponIssue";
import { AdminCouponCampaigns } from "./AdminCouponCampaigns";

export function AdminCoupons() {
    const [tab, setTab] = useState("templates");
    const workspace = useRef<HTMLElement>(null);

    function changeTab(next: string) {
        const current = workspace.current;
        if (current?.querySelector('[data-saving="true"], form[aria-busy="true"]')) return;
        if (current?.querySelector('[data-unsaved="true"]') &&
            !window.confirm("当前页有未保存的内容，确认放弃并切换？")) return;
        setTab(next);
    }

    return (
        <section className="admin-commerce-page" ref={workspace}>
            <AdminSectionHead
                icon={<TicketPercent size={23} />}
                title="优惠券"
                description="支持用户主动领取与管理员发放，每人每种券限领一次。已发出的券保留领取时的优惠及有效期。"
            />
            <Tabs.Root
                value={tab}
                activationMode="manual"
                onValueChange={changeTab}
            >
                <AdminTabList label="优惠券管理视图" options={[
                    {value:"templates",label:<><TicketPercent size={16} aria-hidden="true" />券模板与活动领取</>},
                    {value:"presentation",label:<><Languages size={16} aria-hidden="true" />活动与多语言</>},
                    {value:"issue",label:<><Gift size={16} aria-hidden="true" />发放到用户券包</>},
                    {value:"records",label:<><History size={16} aria-hidden="true" />发放记录</>}
                ]} />
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
