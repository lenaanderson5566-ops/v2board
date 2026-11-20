import { AdminPager } from "./AdminPager";
import { useState, type ReactNode } from "react";
import { Empty, TableViewport } from "../shared/ui";

export function ReportTable({
    headers,
    rows,
    pageSize = 20,
}: {
    headers: string[];
    rows: ReactNode[][];
    pageSize?: number;
}) {
    const [page, setPage] = useState(1);
    const pages = Math.max(1, Math.ceil(rows.length / pageSize));
    const current = Math.min(page, pages);
    if (page !== current) setPage(current);
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
                            .slice((current - 1) * pageSize, current * pageSize)
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
                <AdminPager
                    page={current}
                    size={pageSize}
                    total={rows.length}
                    onChange={setPage}
                />
            )}
        </>
    ) : (
        <Empty text="当前范围暂无记录。" />
    );
}
