import { lazy, Suspense } from "react";
import { AdminRegionSelect } from "./admin-region-select";
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
) => {
    if (field.key === "region_code" && field.type === "select")
        return <AdminRegionSelect label={field.label} value={value} onChange={onChange} />;
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
