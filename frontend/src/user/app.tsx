import { lazy, Suspense } from "react";
import { AnalyticsPrivacy, AnalyticsPrivacyFooter } from "./AnalyticsPrivacy";
import { BrowserAccessGate } from "./EmbeddedBrowserNotice";
import { WorkspaceSkeleton } from "../shared/WorkspaceSkeleton";
import { prepareWorkspaceLanguage } from "../shared/i18n";
import "./app-theme.css";
import "./recovery.css";
import "./entry.css";

// Rendering a lazy element does not request its module until the gate admits it.
const UserWorkspace = lazy(() => Promise.all([
    import("./UserWorkspace"), prepareWorkspaceLanguage(),
]).then(([workspace]) => workspace));

export default function App() {
    return <>
        <BrowserAccessGate footer={<AnalyticsPrivacyFooter />}>
            <Suspense fallback={<WorkspaceSkeleton full />}>
                <UserWorkspace />
            </Suspense>
        </BrowserAccessGate>
        <AnalyticsPrivacy />
    </>;
}
