import { useState } from "react";
import { type Row } from "../shared/api";
import { adminUserLabel } from "./admin-user-label";
import { AdminUserDetails } from "./AdminUserDetails";

export function AdminUserActivityLink({ row }: { row: Row }) {
    const [open, setOpen] = useState(false);
    return <>{row.user_id ? <button className="link" onClick={() => setOpen(true)}>{adminUserLabel(row)}</button> : adminUserLabel(row)}
        {open && <AdminUserDetails key={row.user_id} row={{id:row.user_id,email:row.email}} close={() => setOpen(false)} />}
    </>;
}
