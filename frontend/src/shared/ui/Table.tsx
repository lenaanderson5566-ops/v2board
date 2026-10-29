import { TableViewport } from "./TableViewport";
import { useEffect, useState, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IpLocation } from "../IpLocation";
import { adminStatusCell } from "../admin-status";
import { tx } from "../i18n";
import { ux } from "../ux";
import { moveItem } from "../array-items";
import { boot, type Row } from "../api";
import { Empty } from "./layout";

export function Table({
    data,
    columns,
    actions,
    sort,
    onSort,
    onReorder,
    compact = false,
}: {
    compact?: boolean;
    data: Row[];
    columns: [string, string, ((row: Row) => ReactNode)?][];
    actions?: (row: Row, context?: boolean) => ReactNode;
    sort?: { key: string; direction: string; fields: string[] };
    onSort?: (key: string, direction: string) => void;
    onReorder?: (data: Row[]) => void | Promise<void>;
}) {
    const Viewport = boot.mode === "admin" ? TableViewport : "div";
    const [dragged, setDragged] = useState<number | null>(null);
    const [reorderError, setReorderError] = useState("");
    const [reordering, setReordering] = useState(false);
    const reorderPending = useRef(false);
    const keyboardTarget = useRef<HTMLElement | null>(null);
    const alive = useRef(true);
    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
        };
    }, []);
    useEffect(() => {
        if (reordering || !keyboardTarget.current) return;
        const target = keyboardTarget.current;
        keyboardTarget.current = null;
        if (target.isConnected && (document.activeElement === document.body || document.activeElement === target)) target.focus();
    }, [reordering]);
    async function reorder(from: number, to: number) {
        if (
            !onReorder ||
            reorderPending.current ||
            from === to ||
            to < 0 ||
            to >= data.length
        )
            return;
        reorderPending.current = true;
        setReordering(true);
        setReorderError("");
        try {
            await onReorder(moveItem(data, from, to));
        } catch (cause) {
            if (alive.current) setReorderError((cause as Error).message);
        } finally {
            reorderPending.current = false;
            if (alive.current) {
                setDragged(null);
                setReordering(false);
            }
        }
    }
    const [context, setContext] = useState<{
        row: Row;
        x: number;
        y: number;
    } | null>(null);
    const contextMenu = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!context) return;
        const close = (event: MouseEvent) => {
            if (!contextMenu.current?.contains(event.target as Node))
                setContext(null);
        };
        const escape = (event: KeyboardEvent) => {
            if (event.key === "Escape") setContext(null);
        };
        document.addEventListener("mousedown", close);
        document.addEventListener("keydown", escape);
        return () => {
            document.removeEventListener("mousedown", close);
            document.removeEventListener("keydown", escape);
        };
    }, [context]);
    if (!data.length && boot.mode !== "admin") return <Empty />;
    return (
        <Viewport
            className={`${boot.mode === "admin" ? "" : "table-scroll"} ${compact ? "compact-mobile-table" : ""}`}
            aria-busy={reordering || undefined}
        >
            {onReorder && (
                <p className="table-reorder-help muted">
                    {tx("reorderHelp", {
                        ns: "experience",
                        defaultValue:
                            "Drag to reorder, or focus a sort handle and use ↑ / ↓.",
                    })}
                </p>
            )}
            {reorderError && (
                <div className="alert" role="alert">
                    {reorderError}
                </div>
            )}
            <table>
                <thead>
                    <tr>
                        {onReorder && <th>{ux("sort")}</th>}
                        {columns.map(([k, label]) => (
                            <th
                                scope="col"
                                key={k}
                                aria-sort={
                                    sort?.key === k
                                        ? sort.direction === "ASC"
                                            ? "ascending"
                                            : "descending"
                                        : undefined
                                }
                            >
                                {sort?.fields.includes(k) && onSort ? (
                                    <button
                                        type="button"
                                        className="table-sort"
                                        onClick={() =>
                                            onSort(
                                                k,
                                                sort.key === k &&
                                                    sort.direction === "ASC"
                                                    ? "DESC"
                                                    : "ASC",
                                            )
                                        }
                                    >
                                        {label}
                                        <span aria-hidden="true">
                                            {sort.key === k
                                                ? sort.direction === "ASC"
                                                    ? " ▲"
                                                    : " ▼"
                                                : " ↕"}
                                        </span>
                                    </button>
                                ) : (
                                    label
                                )}
                            </th>
                        ))}
                        {actions && (
                            <th scope="col" className="table-actions">
                                {tx("操作")}
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody>
                    {data.map((r, i) => (
                        <tr
                            key={
                                r.type
                                    ? `${r.type}-${r.id ?? i}`
                                    : (r.id ?? r.trade_no ?? i)
                            }
                            onContextMenu={
                                boot.mode === "admin" && actions
                                    ? (e) => {
                                          e.preventDefault();
                                          setContext({
                                              row: r,
                                              x: Math.min(
                                                  e.clientX,
                                                  window.innerWidth - 220,
                                              ),
                                              y: Math.min(
                                                  e.clientY,
                                                  window.innerHeight - 300,
                                              ),
                                          });
                                      }
                                    : undefined
                            }
                            onDragOver={
                                onReorder
                                    ? (e) => e.preventDefault()
                                    : undefined
                            }
                            onDrop={
                                onReorder
                                    ? (e) => {
                                          e.preventDefault();
                                          if (dragged !== null)
                                              void reorder(dragged, i);
                                      }
                                    : undefined
                            }
                        >
                            {onReorder && (
                                <td>
                                    <button
                                        type="button"
                                        draggable
                                        disabled={reordering}
                                        aria-label={`${ux("sort")} ${r.name || r.title || r.id}`}
                                        aria-keyshortcuts="ArrowUp ArrowDown"
                                        className="row-drag-handle"
                                        onKeyDown={(event) => {
                                            if (
                                                event.altKey ||
                                                event.ctrlKey ||
                                                event.metaKey ||
                                                ![
                                                    "ArrowUp",
                                                    "ArrowDown",
                                                ].includes(event.key)
                                            )
                                                return;
                                            event.preventDefault();
                                            keyboardTarget.current = event.currentTarget;
                                            void reorder(
                                                i,
                                                i +
                                                    (event.key === "ArrowUp"
                                                        ? -1
                                                        : 1),
                                            );
                                        }}
                                        onDragStart={(e) => {
                                            e.dataTransfer.effectAllowed =
                                                "move";
                                            setDragged(i);
                                        }}
                                        onDragEnd={() => setDragged(null)}
                                    >
                                        ☰
                                    </button>
                                </td>
                            )}
                            {columns.map(([k, label, render]) => (
                                <td key={k} data-label={label}>
                                    {boot.mode === "admin" ? (
                                        k === "ip" && !render ? (
                                            <IpLocation row={r} />
                                        ) : (
                                            adminStatusCell(
                                                k,
                                                label,
                                                r[k],
                                                render ? render(r) : undefined,
                                            )
                                        )
                                    ) : render ? (
                                        render(r)
                                    ) : r[k] != null &&
                                      typeof r[k] === "object" ? (
                                        JSON.stringify(r[k])
                                    ) : (
                                        String(r[k] ?? "—")
                                    )}
                                </td>
                            ))}
                            {actions && (
                                <td className="table-actions">
                                    <div className="actions">{actions(r)}</div>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
            {!data.length && (
                <div className="table-empty-state">
                    <Empty />
                </div>
            )}
            {context &&
                actions &&
                createPortal(
                    <div
                        ref={contextMenu}
                        className="admin-context-menu"
                        role="menu"
                        style={{
                            left: Math.max(0, context.x),
                            top: Math.max(0, context.y),
                        }}
                        onClick={(e) => {
                            if ((e.target as Element).closest("button,a[href]"))
                                setContext(null);
                        }}
                    >
                        {actions(context.row, true)}
                    </div>,
                    document.body,
                )}
        </Viewport>
    );
}
