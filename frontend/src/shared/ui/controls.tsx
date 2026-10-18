import { RefreshCw, ChevronLeft, ChevronRight } from "lucide-react";
import { tx } from "../i18n";

export function FilterActions({
    loading = false,
    onReset,
}: {
    loading?: boolean;
    onReset: () => void;
}) {
    return (
        <>
            <button type="submit" className="primary" disabled={loading}>
                {tx("查询")}
            </button>
            <button type="button" disabled={loading} onClick={onReset}>
                {tx("重置")}
            </button>
        </>
    );
}

export function Pager({
    page,
    total,
    size = 20,
    loading = false,
    onChange,
    onSizeChange,
}: {
    page: number;
    total: number;
    size?: number;
    loading?: boolean;
    onChange: (page: number) => void;
    onSizeChange?: (size: number) => void;
}) {
    const count = Math.max(0, Number(total) || 0),
        limit = Math.max(1, size);
    const pages = Math.ceil(count / limit);
    return (
        <nav className="pager" aria-label={tx("分页")} aria-busy={loading}>
            <span>
                {tx("共 {{total}} 条 · 第 {{page}} 页", {
                    total: count,
                    page: count ? page : 0,
                })}{" "}
                · {tx("共 {{total}} 页", { total: pages })}
            </span>
            {onSizeChange && (
                <label className="pager-size">
                    {tx("每页")}{" "}
                    <select
                        aria-label={tx("每页显示行数")}
                        value={size}
                        disabled={loading}
                        onChange={(event) =>
                            onSizeChange(Number(event.target.value))
                        }
                    >
                        {[...new Set([10, 20, 50, 100, size])]
                            .sort((a, b) => a - b)
                            .map((n) => (
                                <option key={n} value={n}>
                                    {n}
                                </option>
                            ))}
                    </select>
                </label>
            )}
            <div className="pager-buttons">
                <button
                    type="button"
                    disabled={loading || page <= 1}
                    onClick={() => onChange(1)}
                    aria-label={tx("首页")}
                >
                    «
                </button>
                <button
                    type="button"
                    disabled={loading || page <= 1}
                    onClick={() => onChange(page - 1)}
                    aria-label={tx("上一页")}
                >
                    <ChevronLeft size={16} />
                </button>
                <button
                    type="button"
                    disabled={loading || page >= pages}
                    onClick={() => onChange(page + 1)}
                    aria-label={tx("下一页")}
                >
                    <ChevronRight size={16} />
                </button>
                <button
                    type="button"
                    disabled={loading || page >= pages}
                    onClick={() => onChange(pages)}
                    aria-label={tx("末页")}
                >
                    »
                </button>
            </div>
        </nav>
    );
}

export function Reload({
    onClick,
    loading = false,
    disabled = false,
}: {
    onClick: () => void;
    loading?: boolean;
    disabled?: boolean;
}) {
    return (
        <button
            type="button"
            onClick={onClick}
            disabled={loading || disabled}
            aria-busy={loading}
        >
            <RefreshCw size={15} />
            {tx("刷新")}
        </button>
    );
}
