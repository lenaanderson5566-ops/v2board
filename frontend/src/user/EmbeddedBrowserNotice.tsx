import { useEffect, useState, type ReactNode } from "react";
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
    const context = currentDevice();
    const [continued, setContinued] = useState("");
    const policy =
        boot.mode === "user"
            ? browserPolicy(context.embedded, boot.browserPolicies)
            : "allow";
    const identity = `${boot.mode}:${context.embedded}:${policy}`;
    useEffect(() => { setContinued(""); }, [identity]);
    if (policy === "allow" || (policy === "prompt" && continued === identity)) return children;
    return (
        <div className="access-page">
            <EmbeddedBrowserNotice
                onContinue={
                    policy === "prompt" ? () => setContinued(identity) : undefined
                }
            />
            {footer}
        </div>
    );
}
export function EmbeddedBrowserNotice({onContinue, compact = false}: {onContinue?: () => void; compact?: boolean} = {}) {
    const context = currentDevice();
    const [href, setHref] = useState(() => location.href);
    useEffect(() => {
        const refresh = () => setHref(location.href);
        window.addEventListener("hashchange", refresh);
        window.addEventListener("popstate", refresh);
        return () => {
            window.removeEventListener("hashchange", refresh);
            window.removeEventListener("popstate", refresh);
        };
    }, []);
    useAnalyticsPage(context.embedded ? (onContinue ? "browser_prompt" : "browser_guide") : null);
    return <BrowserNoticeView {...context} compact={compact} title={boot.title} address={browserHandoffUrl(href)} onContinue={onContinue} onAction={trackAction} languagePicker={<LanguagePicker />} />;
}
