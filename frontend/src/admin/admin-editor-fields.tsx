import { TimeZonePicker } from "../shared/TimeZonePicker";
import { lazy, Suspense } from "react";
import { nodeIdentityControl } from "./NodeIdentityFields";
import { AdminMultiSelect } from "./admin-multiselect";
import type { EditorFieldRenderer } from "../shared/ui";

const AdminMarkdown = lazy(() =>
    import("./admin-markdown").then((module) => ({
        default: module.AdminMarkdown,
    })),
);
const AdminCodeEditor = lazy(() =>
    import("./admin-code-editor").then((module) => ({
        default: module.AdminCodeEditor,
    })),
);

export const adminEditorField: EditorFieldRenderer = (
    field,
    value,
    onChange,
    values,
) => {
    const identity = nodeIdentityControl(field, value, onChange, values);
    if (identity !== undefined) return identity;
    if (field.key === "system_timezone")
        return (
            <TimeZonePicker
                label={field.label}
                value={String(value || "Asia/Shanghai")}
                zones={field.options?.map((option) => option[0]) || []}
                onChange={onChange}
            />
        );
    if (field.markdown)
        return (
            <Suspense fallback={<span className="spinner" />}>
                <AdminMarkdown
                    label={field.label}
                    value={String(value || "")}
                    onChange={onChange}
                />
            </Suspense>
        );
    if (field.type === "json")
        return (
            <Suspense fallback={<span className="spinner" />}>
                <AdminCodeEditor
                    label={field.label}
                    value={
                        typeof value === "string"
                            ? value
                            : value == null
                              ? ""
                              : JSON.stringify(value, null, 2)
                    }
                    onChange={onChange}
                />
            </Suspense>
        );
    if (field.type === "multiselect")
        return (
            <AdminMultiSelect
                label={field.label}
                creatable={field.creatable}
                options={field.options || []}
                value={value}
                onChange={onChange}
            />
        );
};
