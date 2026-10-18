import type { ReactNode } from "react";
import { Check } from "lucide-react";
import { Modal } from "../shared/ui";

export function AdminDisplaySettings({ title, columns, selected, onChange, onReset, close, children }: {
    title: string;
    columns: readonly (readonly [string, string, ...unknown[]])[];
    selected: string[];
    onChange: (columns: string[]) => void;
    onReset: () => void;
    close: () => void;
    children?: ReactNode;
}) {
    return <Modal title={title} close={close}>
        <div className="admin-display-settings">
            <p className="muted">选择需要查看的信息。设置自动保存，仅影响当前浏览器。</p>
            <div className="admin-display-heading"><h3>显示列 <small>{columns.filter(([key]) => selected.includes(key)).length} / {columns.length}</small></h3><button type="button" onClick={onReset}>恢复默认展示</button></div>
            <div className="admin-display-grid" aria-label="可选显示列">
                {columns.map(([key, label]) => <button type="button" key={key} aria-pressed={selected.includes(key)} onClick={() => onChange(selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key])}>
                    <span>{label}</span><Check size={16} aria-hidden="true" />
                </button>)}
            </div>
            {children && <div className="admin-display-extra">{children}</div>}
            <footer><button className="primary" type="button" onClick={close}>完成</button></footer>
        </div>
    </Modal>;
}
