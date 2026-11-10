import { adminRoot, adminTabRoute } from "./admin-navigation";
import { AdminTimeZoneScope } from "./admin-log-time";
import { clearListViews } from "./list-view-state";
import { AdminShell, adminPage } from "./admin-shell";
import AdminContent from "./admin-entry";
import type { Row } from "../shared/api";
import { EditorFieldContext } from "../shared/ui";
import { adminEditorField } from "./admin-editor-fields";
import { useSyncExternalStore } from "react";
import { businessTimeZone, displayTimeZone, subscribeTimeZone } from "../shared/timezone";
import { AdminDisplayTimeZoneProvider } from "./AdminDisplayTimeZone";

const timeZoneSnapshot = () => `${businessTimeZone()}|${displayTimeZone()}`;

export default function AdminWorkspace({
    path,
    user,
    logout,
}: {
    path: string;
    user: Row;
    logout: () => void;
}) {
    return <AdminDisplayTimeZoneProvider user={user}>
        <AdminWorkspaceContent path={path} user={user} logout={logout} />
    </AdminDisplayTimeZoneProvider>;
}

function AdminWorkspaceContent({ path, user, logout }: { path: string; user: Row; logout: () => void }) {
    // Repaint existing records without remounting pages, discarding drafts or refetching.
    useSyncExternalStore(subscribeTimeZone, timeZoneSnapshot, timeZoneSnapshot);
    const route = adminPage(path);
    const current = route.split("?", 1)[0];
    return (
        <EditorFieldContext.Provider value={adminEditorField}>
            <AdminShell
                page={adminTabRoute(route)}
                current={adminRoot(current)}
                user={user}
                logout={() => {
                    clearListViews();
                    logout();
                }}
            >
                <AdminTimeZoneScope>
                    <AdminContent route={route} />
                </AdminTimeZoneScope>
            </AdminShell>
        </EditorFieldContext.Provider>
    );
}
