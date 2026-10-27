import type { Row } from "../shared/api";
import type { EditorFieldRenderer } from "../shared/ui";
import { AdminRegionSelect } from "./admin-region-select";
import { AdminCitySelect } from "./admin-city-select";
import { AdminMultiSelect } from "./admin-multiselect";
import { NodeNamePreview } from "./NodeNamePreview";
import { useNodeCatalog } from "./node-dictionary";
import { nodeLineFields } from "./node-line-fields";

export const nodeIdentityKeys = ["name", "region_code", "city_code", "display_label", "tags"];

// Both Editor-based deployment forms and controlled connection drafts use these controls.
export const nodeIdentityControl: EditorFieldRenderer = (field, value, onChange, values) => {
    if (field.key === "region_code" && field.type === "select") return <>
        <AdminRegionSelect label={field.label} value={value} onChange={onChange} />
        <NodeNamePreview values={values} />
    </>;
    if (field.key === "city_code") return <AdminCitySelect label={field.label} value={value} region={values.region_code} onChange={onChange} />;
    if (field.key === "tags") return <AdminMultiSelect label={field.label} value={value} options={(Array.isArray(value) ? value : []).map(tag => [String(tag), String(tag)])} creatable onChange={onChange} />;
    if ((field.key === "name" && field.label === "节点名称") || field.key === "display_label") return <div className="input-control"><input aria-label={field.label} value={String(value ?? "")} required={field.required} placeholder={field.placeholder} onChange={event => onChange(event.target.value)} /></div>;
};

export function NodeIdentityFields({ values, onChange, keys = nodeIdentityKeys, disabled = false }: {
    values: Row;
    onChange: (key: string, value: unknown) => void;
    keys?: string[];
    disabled?: boolean;
}) {
    const catalog = useNodeCatalog();
    return <fieldset className="field-grid node-identity-fields" disabled={disabled}>
        {nodeLineFields([], catalog).filter(field => keys.includes(field.key)).map(field => <label key={field.key} data-field={field.key} style={{ gridColumn: "span 12" }}>
            <span>{field.label}{field.required && " *"}</span>
            <div inert={disabled}>{nodeIdentityControl(field, values[field.key], value => onChange(field.key, value), values)}</div>
            {field.hint && <small className="muted">{field.hint}</small>}
        </label>)}
    </fieldset>;
}
