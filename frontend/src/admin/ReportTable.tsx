import { useState, type ReactNode } from "react";
import { Empty, Pager, TableViewport } from "../shared/ui";

export function ReportTable({
    headers,
    rows,
    pageSize,
}: {
    headers: string[];
    rows: ReactNode[][];
    pageSize?: number;
}) {
    const [page, setPage] = useState(0);
    const size = pageSize || Math.max(rows.length, 1);
    const pages = Math.max(1, Math.ceil(rows.length / size));
    const current = Math.min(page, pages - 1);
    return rows.length ? (
        <>
            <TableViewport>
                <table>
                    <thead>
                        <tr>
                            {headers.map((h) => (
                                <th key={h} scope="col">
                                    {h}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows
                            .slice(current * size, (current + 1) * size)
                            .map((r, i) => (
                                <tr key={i}>
                                    {r.map((v, j) => (
                                        <td key={j}>{v}</td>
                                    ))}
                                </tr>
                            ))}
                    </tbody>
                </table>
            </TableViewport>
            {pages > 1 && (
                <Pager
                    page={current + 1}
                    size={size}
                    total={rows.length}
                    onChange={(next) => setPage(next - 1)}
                />
            )}
        </>
    ) : (
        <Empty text="当前范围暂无记录。" />
    );
}
