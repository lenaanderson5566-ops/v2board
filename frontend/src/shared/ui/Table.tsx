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
    const [dragged, setDragged] = useState<number | null>(null);
    const [reorderError, setReorderError] = useState("");
    const [reordering, setReordering] = useState(false);
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
        <div
            className={`table-scroll ${compact ? "compact-mobile-table" : ""}`}
        >
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
                        {actions && <th>{tx("操作")}</th>}
                    </tr>
                </thead>
                <tbody>
                    {!data.length && (
                        <tr>
                            <td
                                colSpan={
                                    columns.length +
                                    (actions ? 1 : 0) +
                                    (onReorder ? 1 : 0)
                                }
                            >
                                <Empty />
                            </td>
                        </tr>
                    )}
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
                                    ? async (e) => {
                                          e.preventDefault();
                                          if (
                                              dragged === null ||
                                              dragged === i ||
                                              reordering
                                          )
                                              return;
                                          setReordering(true);
                                          setReorderError("");
                                          try {
                                              await onReorder(
                                                  moveItem(data, dragged, i),
                                              );
                                          } catch (error) {
                                              setReorderError(
                                                  (error as Error).message,
                                              );
                                          } finally {
                                              setDragged(null);
                                              setReordering(false);
                                          }
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
                                        aria-label={`排序 ${r.name || r.title || r.id}`}
                                        className="row-drag-handle"
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
                                <td>
                                    <div className="actions">{actions(r)}</div>
                                </td>
                            )}
                        </tr>
                    ))}
                </tbody>
            </table>
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
        </div>
    );
}
