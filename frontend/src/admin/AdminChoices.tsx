import "./admin-controls.css";
import type { ReactNode } from "react";
import * as Tabs from "@radix-ui/react-tabs";

export type AdminChoice<T extends string = string> = { value: T; label: ReactNode; disabled?: boolean };
type ChoiceProps<T extends string> = { label: string; options: readonly AdminChoice<T>[]; value: T; onChange: (value: T) => void };

// Filters and guarded view switches remain ordinary buttons: they do not claim
// tab semantics when their content is not owned by a tab panel.
export function AdminChoiceGroup<T extends string>({ label, options, value, onChange, variant = "filter", disabled = false, className = "", children }: ChoiceProps<T> & {
    variant?: "filter" | "navigation"; disabled?: boolean; className?: string; children?: ReactNode;
}) {
    return <div role="group" aria-label={label} className={`${variant === "navigation" ? "section-tabs" : "admin-choice-group"} ${className}`}>
        {options.map(option => <button key={option.value} type="button" aria-pressed={value === option.value}
            disabled={disabled || option.disabled} onClick={() => onChange(option.value)}>{option.label}</button>)}
        {children}
    </div>;
}

export function AdminTabList({ label, options }: { label: string; options: readonly AdminChoice[] }) {
    return <Tabs.List className="section-tabs" aria-label={label}>
        {options.map(option => <Tabs.Trigger key={option.value} value={option.value} disabled={option.disabled}>{option.label}</Tabs.Trigger>)}
    </Tabs.List>;
}

// Manual activation avoids fetching another workspace merely on arrow-key focus.
export function AdminTabs<T extends string>({ label, options, value, onChange, children }: ChoiceProps<T> & { children: ReactNode }) {
    return <Tabs.Root className="admin-workspace-tabs" value={value} onValueChange={next => {
        const option = options.find(option => option.value === next);
        if (option && !option.disabled) onChange(option.value);
    }} activationMode="manual">
        <AdminTabList label={label} options={options} />
        <Tabs.Content key={value} value={value}>{children}</Tabs.Content>
    </Tabs.Root>;
}
