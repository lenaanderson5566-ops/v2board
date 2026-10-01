import { useState } from "react";
import { admin, request, query, rows, bytes, type Row } from "./api";
import { Modal, State, Panel, Table, Reload, useData } from "./ui";
import { moveItem, sortPayload, type SortKind } from "./admin-actions";
export function SortButton({
    items,
    kind,
    path,
    onSaved,
}: {
    items: Row[];
    kind: SortKind;
    path: string;
    onSaved: () => void;
}) {
    const [draft, setDraft] = useState<Row[] | null>(null),
        [busy, setBusy] = useState(false),
        [error, setError] = useState("");
    const [drag, setDrag] = useState<number | null>(null);
    return (
        <>
            <button
                title={
                    items.length < 2
                        ? "至少两个项目才能调整排序"
                        : "调整全部项目的显示顺序"
                }
                disabled={items.length < 2}
                onClick={() => {
                    setDraft([...items]);
                    setError("");
                }}
            >
                调整排序
            </button>
            {draft && (
                <Modal
                    title="调整排序"
                    close={() => {
                        if (!busy) setDraft(null);
                    }}
                >
                    <div className="pad">
                        <p className="muted">
                            拖动项目或使用上移、下移；保存后才生效。
                        </p>
                        <ol className="sort-list">
                            {draft.map((r, i) => (
                                <li
                                    key={`${r.type || ""}:${r.id}`}
                                    draggable={!busy}
                                    onDragStart={() => setDrag(i)}
                                    onDragOver={(e) => e.preventDefault()}
                                    onDrop={(e) => {
                                        e.preventDefault();
                                        if (drag != null)
                                            setDraft(moveItem(draft, drag, i));
                                        setDrag(null);
                                    }}
                                >
                                    <span>
                                        {i + 1}. {r.name || r.title}{" "}
                                        {kind === "nodes"
                                            ? `（${r.type} #${r.id}）`
                                            : `（#${r.id}）`}
                                    </span>
                                    <div className="actions">
                                        <button
                                            aria-label={`上移第 ${i + 1} 项`}
                                            disabled={busy || i === 0}
                                            onClick={() =>
                                                setDraft(
                                                    moveItem(draft, i, i - 1),
                                                )
                                            }
                                        >
                                            上移
                                        </button>
                                        <button
                                            aria-label={`下移第 ${i + 1} 项`}
                                            disabled={
                                                busy || i === draft.length - 1
                                            }
                                            onClick={() =>
                                                setDraft(
                                                    moveItem(draft, i, i + 1),
                                                )
                                            }
                                        >
                                            下移
                                        </button>
                                    </div>
                                </li>
                            ))}
                        </ol>
                        {error && (
                            <p className="alert" role="alert">
                                {error}
                            </p>
                        )}
                        <button
                            className="primary"
                            disabled={busy}
                            onClick={async () => {
                                setBusy(true);
                                setError("");
                                try {
                                    await request(
                                        path,
                                        sortPayload(kind, draft),
                                    );
                                    onSaved();
                                    setDraft(null);
                                } catch (e) {
                                    setError((e as Error).message);
                                } finally {
                                    setBusy(false);
                                }
                            }}
                        >
                            {busy ? "保存中…" : "保存排序"}
                        </button>
                    </div>
                </Modal>
            )}
        </>
    );
}
export function LegacyRanks() {
    const [day, setDay] = useState("today");
    const server = useData<Row[]>(
        day === "today"
            ? admin("stat/getServerTodayRank")
            : admin("stat/getServerLastRank"),
    );
    const user = useData<Row[]>(
        day === "today"
            ? admin("stat/getUserTodayRank")
            : admin("stat/getUserLastRank"),
    );
    const orders = useData<Row[]>(admin("stat/getOrder"));
    return (
        <>
            <Panel
                title="流量排行"
                actions={
                    <>
                        <button
                            className={day === "today" ? "primary" : ""}
                            onClick={() => setDay("today")}
                        >
                            今日
                        </button>
                        <button
                            className={day === "last" ? "primary" : ""}
                            onClick={() => setDay("last")}
                        >
                            昨日
                        </button>
                        <Reload
                            onClick={() => {
                                server.reload();
                                user.reload();
                            }}
                        />
                    </>
                }
            >
                <div className="split">
                    <State {...server} retry={server.reload}>
                        <Table
                            data={server.data || []}
                            columns={[
                                ["server_name", "节点"],
                                ["server_type", "类型"],
                                [
                                    "total",
                                    "流量（GB）",
                                    (r) => Number(r.total).toFixed(2),
                                ],
                            ]}
                        />
                    </State>
                    <State {...user} retry={user.reload}>
                        <Table
                            data={user.data || []}
                            columns={[
                                ["email", "用户邮箱"],
                                [
                                    "total",
                                    "流量（GB）",
                                    (r) => Number(r.total).toFixed(2),
                                ],
                            ]}
                            actions={(r) => (
                                <a
                                    className="button"
                                    href={`#/users?user_id=${r.user_id}`}
                                >
                                    查看用户
                                </a>
                            )}
                        />
                    </State>
                </div>
            </Panel>
            <Panel
                title="近 31 天运营记录"
                actions={<Reload onClick={orders.reload} />}
            >
                <State {...orders} retry={orders.reload}>
                    <Table
                        data={orders.data || []}
                        columns={[
                            ["date", "日期"],
                            ["type", "指标"],
                            ["value", "数值"],
                        ]}
                    />
                </State>
            </Panel>
        </>
    );
}
export function QueueDetails() {
    const workload = useData<Row[]>(admin("system/getQueueWorkload")),
        masters = useData<Row[]>(admin("system/getQueueMasters"));
    return (
        <>
            <Panel
                title="队列工作负载"
                actions={<Reload onClick={workload.reload} />}
            >
                <State {...workload} retry={workload.reload}>
                    <Table
                        data={rows(workload.data)}
                        columns={[
                            ["name", "队列"],
                            ["length", "等待任务"],
                            ["wait", "等待时间（秒）"],
                            ["processes", "进程数"],
                        ]}
                    />
                </State>
            </Panel>
            <Panel
                title="队列主进程"
                actions={<Reload onClick={masters.reload} />}
            >
                <State {...masters} retry={masters.reload}>
                    <Table
                        data={rows(masters.data)}
                        columns={[
                            ["name", "主进程"],
                            ["status", "状态"],
                            [
                                "supervisors",
                                "监控进程",
                                (r) => (
                                    <div>
                                        {(r.supervisors || []).map(
                                            (supervisor: Row) => (
                                                <p key={supervisor.name}>
                                                    {supervisor.name} ·{" "}
                                                    {supervisor.status} ·{" "}
                                                    {Object.values(
                                                        supervisor.processes ||
                                                            {},
                                                    ).reduce<number>(
                                                        (sum, count) =>
                                                            sum + Number(count),
                                                        0,
                                                    )}{" "}
                                                    个进程
                                                </p>
                                            ),
                                        )}
                                    </div>
                                ),
                            ],
                        ]}
                    />
                </State>
            </Panel>
        </>
    );
}
