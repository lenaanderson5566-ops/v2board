import { adminWorkspace } from "./admin-navigation";
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
    const current = adminPage(path);
    return (
        <EditorFieldContext.Provider value={adminEditorField}>
            <AdminShell
                page={current}
                current={
                    adminWorkspace(current)
                        ? adminWorkspace(current)!.root
                        : current === "invitation-rules"
                          ? "invitations"
                          : current === "overview-system" ||
                              current === "overview-risk"
                            ? "overview"
                            : current === "plans-translations"
                              ? "plans"
                              : current
                }
                user={user}
                logout={() => {
                    clearListViews();
                    logout();
                }}
            >
                <AdminTimeZoneScope>
                    <AdminContent current={current} />
                </AdminTimeZoneScope>
            </AdminShell>
        </EditorFieldContext.Provider>
    );
}
