import { useState, type ReactNode } from "react";
import { currentDevice } from "../shared/user-experience";
import { boot } from "../shared/api";
import { browserHandoffUrl, browserPolicy } from "../shared/browser-access";
import { useAnalyticsPage, trackAction } from "./product-analytics";
import { LanguagePicker } from "../shared/LanguagePicker";
import { BrowserNoticeView } from "../shared/ui/BrowserNoticeView";
export function BrowserAccessGate({
    children,
    footer,
}: {
    children: ReactNode;
    footer?: ReactNode;
}) {
    const [continued, setContinued] = useState(false);
    const policy =
        boot.mode === "user"
            ? browserPolicy(currentDevice().embedded, boot.browserPolicies)
            : "allow";
    if (policy === "allow" || continued) return children;
    return (
        <div className="access-page">
            <EmbeddedBrowserNotice
                onContinue={
                    policy === "prompt" ? () => setContinued(true) : undefined
                }
            />
            {footer}
        </div>
    );
}
export function EmbeddedBrowserNotice({onContinue}: {onContinue?: () => void} = {}) {
    const context = currentDevice();
    useAnalyticsPage(context.embedded ? (onContinue ? "browser_prompt" : "browser_guide") : null);
    return <BrowserNoticeView {...context} title={boot.title} address={browserHandoffUrl(location.href)} onContinue={onContinue} onAction={trackAction} languagePicker={<LanguagePicker />} />;
}
