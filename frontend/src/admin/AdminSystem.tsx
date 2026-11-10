import { useState } from "react";
import { Panel } from "../shared/ui";
import { OperationsDetails } from "./OperationsAnalytics";
import { AdminObservability } from "./AdminObservability";
import { QueueDetails } from "./admin-tools";

export default function AdminSystem() {
    const [details, setDetails] = useState(false);
    return (
        <>
            <AdminObservability />
            <Panel
                title="队列进程详情"
                actions={<button onClick={() => setDetails(open => !open)}>{details ? "收起详情" : "查看详情"}</button>}
            >
                {details && <QueueDetails />}
            </Panel>
            <OperationsDetails section="health" />
        </>
    );
}
