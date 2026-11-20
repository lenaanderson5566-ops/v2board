import { useEffect, useState, type ComponentProps } from "react";
import { Table } from "../shared/ui";
import { mergePageOrder } from "./admin-actions";
import { AdminPager } from "./AdminPager";

export function AdminPagedTable({ data, onReorder, ...table }: ComponentProps<typeof Table>) {
    const [page, setPage] = useState(1);
    const [size, setSize] = useState(20);
    const current = Math.min(page, Math.max(1, Math.ceil(data.length / size)));
    useEffect(() => {
        if (page !== current) setPage(current);
    }, [page, current]);

    return (
        <>
            <Table {...table} data={data.slice((current - 1) * size, current * size)}
                onReorder={onReorder && (rows => onReorder(mergePageOrder(data, rows)))} />
            {(data.length > 20 || size !== 20) && (
                <AdminPager page={current} size={size} total={data.length} onChange={setPage}
                    onSizeChange={nextSize => { setSize(nextSize); setPage(1); }} />
            )}
        </>
    );
}
