import { useEffect, useId, useRef, useState, type ComponentProps } from "react";
import { Pager } from "../shared/ui";
import { getPageCount } from "../shared/ui/controls";

type AdminPagerProps = ComponentProps<typeof Pager>;

function visiblePages(current: number, pages: number): (number | "left" | "right")[] {
    if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
    if (current <= 4) return [1, 2, 3, 4, 5, "right", pages];
    if (current >= pages - 3) return [1, "left", pages - 4, pages - 3, pages - 2, pages - 1, pages];
    return [1, "left", current - 1, current, current + 1, "right", pages];
}

export function AdminPager(props: AdminPagerProps) {
    const { page, size = 20, loading, totalUnavailable, onChange } = props;
    const pages = getPageCount(props);
    const lastPage = Math.max(1, pages);
    const current = Math.min(Math.max(1, page), lastPage);
    const correcting = !loading && !totalUnavailable && page !== current;
    const correction = useRef("");
    // Keep the clicked page mounted while the next response's total is pending.
    const [previousPages, setPreviousPages] = useState(0);
    useEffect(() => {
        if (!loading) setPreviousPages(totalUnavailable ? 0 : pages);
    }, [loading, pages, totalUnavailable]);

    useEffect(() => {
        if (!correcting) {
            correction.current = "";
            return;
        }
        const transition = `${page}:${current}`;
        if (correction.current !== transition) {
            correction.current = transition;
            onChange(current);
        }
    }, [correcting, current, onChange, page]);

    const busy = Boolean(loading || correcting);
    const displayPages = loading && totalUnavailable === true ? previousPages : pages;
    const displayPage = Math.max(1, Math.min(page, displayPages));
    const showNumbers = !totalUnavailable || (loading && displayPages > 0);
    const pageNumbers = showNumbers ? visiblePages(displayPage, displayPages).map(item => {
        if (typeof item !== "number") return <span key={item} aria-hidden="true">…</span>;
        const selected = item === displayPage;
        const blocked = selected || busy || Boolean(totalUnavailable);
        return <button key={item} type="button" className="pager-number"
            aria-label={`第 ${item} 页`} aria-current={selected ? "page" : undefined}
            aria-disabled={blocked || undefined}
            onClick={() => { if (!blocked) onChange(item); }}>
            {item}
        </button>;
    }) : undefined;
    const summary = totalUnavailable === "unknown"
        ? `第 ${page} 页 · 总数未知`
        : pages === 0 ? (props.total === undefined ? "暂无可浏览的页面" : "共 0 条") : undefined;
    return (
        <Pager
            {...props}
            page={correcting ? current : page}
            loading={busy}
            summary={summary}
            pageNumbers={pageNumbers}
        >
            {((!totalUnavailable && pages > 1) || (props.preserveFocus && busy && totalUnavailable === true)) && (
                <PageJump page={page} pages={pages} size={size} blocked={busy || Boolean(totalUnavailable)} onChange={onChange} />
            )}
        </Pager>
    );
}

function PageJump({ page, pages, size, blocked, onChange }: {
    page: number;
    pages: number;
    size: number;
    blocked: boolean;
    onChange: (page: number) => void;
}) {
    const [draft, setDraft] = useState("");
    const [invalid, setInvalid] = useState(false);
    const hintId = useId();
    useEffect(() => {
        setDraft("");
        setInvalid(false);
    }, [page, pages, size]);

    function submit() {
        if (blocked || !draft.trim()) return;
        const value = draft.trim();
        const target = Number(value);
        if (!/^\d+$/.test(value) || !Number.isSafeInteger(target) || target < 1 || target > pages) {
            setInvalid(true);
            return;
        }
        setInvalid(false);
        setDraft("");
        if (target !== page) onChange(target);
    }

    return (
        <div className="admin-page-jump">
            <label>前往
                <input
                    type="text" inputMode="numeric" autoComplete="off"
                    aria-label="跳转页码" value={draft} readOnly={blocked}
                    aria-disabled={blocked || undefined} aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? hintId : undefined}
                    onChange={event => {
                        if (!blocked) {
                            setDraft(event.target.value);
                            setInvalid(false);
                        }
                    }}
                    onKeyDown={event => {
                        if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                            event.preventDefault();
                            submit();
                        }
                    }}
                />页
            </label>
            <button type="button" aria-disabled={blocked || !draft.trim() || undefined} onClick={submit}>跳转</button>
            {invalid && <span className="admin-page-jump-error" id={hintId} role="alert">请输入 1 至 {pages} 的整数</span>}
        </div>
    );
}
