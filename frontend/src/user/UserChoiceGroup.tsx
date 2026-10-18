import type { ReactNode } from "react";
import "./user-controls.css";

export function UserChoiceGroup<T extends string | number>({
    label,
    value,
    options,
    onChange,
    disabled = false,
    compact = false,
    className = "",
}: {
    label: string;
    value: T;
    options: readonly {
        value: T;
        label: ReactNode;
        disabled?: boolean;
        controls?: string;
    }[];
    onChange: (value: T) => void;
    disabled?: boolean;
    compact?: boolean;
    className?: string;
}) {
    return (
        <div
            className={`user-choice-group${compact ? " user-choice-compact" : ""} ${className}`}
            role="group"
            aria-label={label}
        >
            {options.map((option) => (
                <button
                    type="button"
                    key={option.value}
                    aria-pressed={value === option.value}
                    aria-controls={option.controls}
                    disabled={disabled || option.disabled}
                    onClick={() => onChange(option.value)}
                >
                    {option.label}
                </button>
            ))}
        </div>
    );
}
