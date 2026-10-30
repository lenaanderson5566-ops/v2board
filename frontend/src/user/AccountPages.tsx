import { lazy } from "react";
import { Bell, Settings } from "lucide-react";
import { SettingsHeading } from "./SettingsHeading";
import { TelegramIntegration } from "./TelegramIntegration";
import { NotificationPreferences } from "./NotificationPreferences";
import { ac } from "../shared/account-copy";
import { tx } from "../shared/i18n";
import { useData, State } from "../shared/ui";

const AccountPreferences = lazy(() => import("./AccountPreferences").then(module => ({ default: module.AccountPreferences })));

export function Notifications() {
    const d = useData("user/info");
    return (
        <div className="settings-content notification-settings">
            <SettingsHeading icon={<Bell size={24}/>} title={tx("通知设置")} description={ac("notificationIntro")} />
            <State {...d} retry={d.reload}>
                {d.data && <NotificationPreferences initial={d.data} />}
            </State>
        </div>
    );
}

export function Profile() {
    const config = useData("user/comm/config");
    const d = useData("user/info");
    return (
        <div className="settings-content account-preferences">
            <SettingsHeading icon={<Settings size={24}/>} title={tx("账户设置")} description={tx("账户信息")} />
            <State {...d} retry={d.reload}>
                <AccountPreferences user={d.data || {}} />
            </State>
            {Boolean(config.data?.is_telegram) && <TelegramIntegration />}
        </div>
    );
}
