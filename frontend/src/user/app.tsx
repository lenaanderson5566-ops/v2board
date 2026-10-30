import { lazy, Suspense } from "react";
import { AnalyticsPrivacy, AnalyticsPrivacyFooter } from "./AnalyticsPrivacy";
import { BrowserAccessGate } from "./EmbeddedBrowserNotice";
import { WorkspaceSkeleton } from "../shared/WorkspaceSkeleton";
import "./app-theme.css";
import "./recovery.css";
import "../shared/style.css";
import "../shared/console.css";
import "./user-experience.css";
import "./product.css";

// Rendering a lazy element does not request its module until the gate admits it.
const UserWorkspace = lazy(() => import("./UserWorkspace"));

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
