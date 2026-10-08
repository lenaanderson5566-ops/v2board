import { AdminShell, adminPage } from "./admin-shell";
import AdminContent from "./admin-entry";
import type { Row } from "../shared/api";
import { EditorFieldContext } from "../shared/ui";
import { adminEditorField } from "./admin-editor-fields";

export default function AdminWorkspace({
    path,
    user,
    logout,
}: {
    path: string;
    user: Row;
    logout: () => void;
}) {
    const current = adminPage(path);
    return (
        <EditorFieldContext.Provider value={adminEditorField}>
            <AdminShell current={current} user={user} logout={logout}>
                <AdminContent current={current} />
            </AdminShell>
        </EditorFieldContext.Provider>
    );
}
