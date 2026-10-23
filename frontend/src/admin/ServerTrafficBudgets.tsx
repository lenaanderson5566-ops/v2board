import { useState } from "react";
import { admin, request, rows, bytes, type Row } from "../shared/api";
import { useData, State, Table, Modal, Panel } from "../shared/ui";
export function ServerTrafficBudgets({
    nodes,
    close,
    onSaved,
}: {
    nodes: Row[];
    close?: () => void;
    onSaved: () => void;
}) {
    const d = useData<Row[]>(admin("server/traffic-budget/fetch"));
    const [draft, setDraft] = useState<Row | null>(null),
        [error, setError] = useState(""),
        [busy, setBusy] = useState(false);
    const [gib, setGib] = useState("0");
    const edit = (r: Row) => {
        setDraft({ ...r, nodes: r.nodes || [] });
        setGib(String(Number(r.limitBytes || 0) / 1073741824));
        setError("");
    };
    const content = (
        <div className="pad server-traffic-content">
            <p>
                将同一服务器的代理服务绑定到同一额度。首次绑定导入已有的近期节点统计；关联线路自动沿用代理服务。0
                表示不限额，达限后停止连接，提高限额后自动恢复。
            </p>
            <State {...d}>
                <Table
                    data={rows(d.data)}
                    columns={[
                        ["name", "服务器"],
                        ["usedBytes", "本周期", (r) => bytes(r.usedBytes)],
                        [
                            "limitBytes",
                            "限额",
                            (r) =>
                                Number(r.limitBytes) > 0
                                    ? bytes(r.limitBytes)
                                    : "不限",
                        ],
                        [
                            "thisMonth",
                            "本月",
                            (r) =>
                                bytes(
                                    Number(r.thisMonth?.uploadBytes || 0) +
                                        Number(r.thisMonth?.downloadBytes || 0),
                                ),
                        ],
                        [
                            "last30Days",
                            "近30天",
                            (r) =>
                                bytes(
                                    Number(r.last30Days?.uploadBytes || 0) +
                                        Number(
                                            r.last30Days?.downloadBytes || 0,
                                        ),
                                ),
                        ],
                        [
                            "blocked",
                            "状态",
                            (r) => (r.blocked ? "已限制" : "可用"),
                        ],
                        [
                            "actions",
                            "操作",
                            (r) => (
                                <button onClick={() => edit(r)}>修改</button>
                            ),
                        ],
                    ]}
                />
            </State>
            <button
                onClick={() =>
                    edit({
                        name: "",
                        limitBytes: 0,
                        countingMode: "both",
                        resetDay: 1,
                        nodes: [],
                    })
                }
            >
                添加服务器额度
            </button>
            {draft && (
                <form
                    onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        setError("");
                        try {
                            const limit = Number(gib) * 1073741824;
                            if (
                                !Number.isSafeInteger(Math.round(limit)) ||
                                limit < 0
                            )
                                throw new Error("请输入有效限额");
                            await request(admin("server/traffic-budget/save"), {
                                ...draft,
                                limitBytes: Math.round(limit),
                            });
                            setDraft(null);
                            d.reload();
                            onSaved();
                        } catch (e) {
                            setError(
                                e instanceof Error ? e.message : "保存失败",
                            );
                        } finally {
                            setBusy(false);
                        }
                    }}
                >
                    <label>
                        服务器名称
                        <input
                            required
                            value={draft.name}
                            onChange={(e) =>
                                setDraft({ ...draft, name: e.target.value })
                            }
                        />
                    </label>
                    <label>
                        流量限额（GiB，0 不限）
                        <input
                            type="number"
                            min="0"
                            step="0.001"
                            required
                            value={gib}
                            onChange={(e) => setGib(e.target.value)}
                        />
                    </label>
                    <label>
                        计费方向
                        <select
                            value={draft.countingMode}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    countingMode: e.target.value,
                                })
                            }
                        >
                            <option value="both">上传 + 下载</option>
                            <option value="upload">仅上传</option>
                            <option value="download">仅下载</option>
                        </select>
                    </label>
                    <label>
                        每月重置日（1 为自然月）
                        <input
                            type="number"
                            min="1"
                            max="28"
                            required
                            value={draft.resetDay}
                            onChange={(e) =>
                                setDraft({
                                    ...draft,
                                    resetDay: Number(e.target.value),
                                })
                            }
                        />
                    </label>
                    <fieldset>
                        <legend>服务器上的节点</legend>
                        {nodes
                            .filter((n) => !n.service_id)
                            .map((n) => {
                                const selected = draft.nodes.some(
                                    (x: Row) =>
                                        x.type === n.type && x.id === n.id,
                                );
                                const other = rows(d.data).some(
                                    (b) =>
                                        b.id !== draft.id &&
                                        b.nodes.some(
                                            (x: Row) =>
                                                x.type === n.type &&
                                                x.id === n.id,
                                        ),
                                );
                                return (
                                    <label key={`${n.type}:${n.id}`}>
                                        <input
                                            type="checkbox"
                                            checked={selected}
                                            disabled={other}
                                            onChange={(e) =>
                                                setDraft({
                                                    ...draft,
                                                    nodes: e.target.checked
                                                        ? [
                                                              ...draft.nodes,
                                                              {
                                                                  type: n.type,
                                                                  id: n.id,
                                                              },
                                                          ]
                                                        : draft.nodes.filter(
                                                              (x: Row) =>
                                                                  !(
                                                                      x.type ===
                                                                          n.type &&
                                                                      x.id ===
                                                                          n.id
                                                                  ),
                                                          ),
                                                })
                                            }
                                        />
                                        {n.name} ({n.type} #{n.id})
                                        {other ? " · 已绑定其他服务器" : ""}
                                    </label>
                                );
                            })}
                    </fieldset>
                    <p>
                        上传/下载按节点代理的方向统计。本月、近30天显示双向总量；周期用量按所选计费方向计算。V2Box
                        本地限制需升级节点，V2Node 通过用户列表同步限制。
                    </p>
                    {error && (
                        <div role="alert" className="alert">
                            {error}
                        </div>
                    )}
                    <button disabled={busy} type="submit">
                        保存额度
                    </button>
                    <button type="button" onClick={() => setDraft(null)}>
                        取消
                    </button>
                </form>
            )}
        </div>
    );
    return close ? (
        <Modal title="服务器流量" close={close}>
            {content}
        </Modal>
    ) : (
        <Panel
            title="服务器流量"
            actions={<button onClick={d.reload}>刷新统计</button>}
        >
            {content}
        </Panel>
    );
}
