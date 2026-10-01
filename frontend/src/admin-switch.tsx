import { useState } from "react";
export function AdminSwitch({
    checked,
    label,
    onChange,
}: {
    checked: boolean;
    label: string;
    onChange: (checked: boolean) => Promise<void>;
}) {
    const [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    return (
        <span className="admin-list-switch">
            <button
                type="button"
                role="switch"
                aria-label={label}
                aria-checked={checked}
                className="toggle-control"
                disabled={busy}
                onClick={async () => {
                    setBusy(true);
                    setError("");
                    try {
                        await onChange(!checked);
                    } catch (e) {
                        setError((e as Error).message);
                    } finally {
                        setBusy(false);
                    }
                }}
            >
                <span className="toggle-track">
                    <i />
                </span>
            </button>
            {error && <small role="alert">{error}</small>}
        </span>
    );
}
