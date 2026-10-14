import { useState } from "react";
import { admin, request, type Row } from "../shared/api";
import { State, Modal, Reload, Pager } from "../shared/ui";
import { formatInstant } from "../shared/timezone";
import { useData } from "../shared/ui";
import { useAdminOperation } from "./admin-operation";
import { AdminOperationNotice } from "./admin-section";
import {
    type CouponCampaign,
    couponCampaignStatuses,
    couponRecipientStatuses,
    couponRecipientReasons,
} from "./coupon-campaign";

export function AdminCouponCampaigns() {
    const [pageSize, setPageSize] = useState(20);
    const [page, setPage] = useState(1);
    const list = useData<CouponCampaign[]>(
        admin(`coupon-campaign/fetch?current=${page}&pageSize=${pageSize}`),
    );
    const [selected, setSelected] = useState<CouponCampaign | null>(null);
    const [cancelling, setCancelling] = useState<CouponCampaign | null>(null);
    const operation = useAdminOperation();
    return (
        <section className="panel">
            <div className="panel-head">
                <h2>优惠券发放记录</h2>
                <Reload onClick={list.reload} loading={list.loading} />
            </div>
            <p className="pad muted">
                每分钟分批发放。重复领取会跳过，失败或取消的预留库存会退回；已发出的券保留原条款。仅创建批次的管理员可以取消剩余发放。
            </p>
            <AdminOperationNotice notice={operation.notice} />
            <State {...list} retry={list.reload}>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>批次 / 创建时间</th>
                                <th>优惠券</th>
                                <th>范围</th>
                                <th>进度</th>
                                <th>状态</th>
                                <th>操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {list.data?.map((batch) => (
                                <tr key={batch.id}>
                                    <td>
                                        #{batch.id}
                                        <br />
                                        {formatInstant(batch.createdAt)}
                                    </td>
                                    <td>
                                        {batch.couponName} · 减{" "}
                                        {batch.discountPercent}%
                                    </td>
                                    <td>
                                        {batch.scope === "all"
                                            ? "全员"
                                            : batch.scope === "filtered"
                                              ? "筛选用户"
                                              : "指定用户"}{" "}
                                        · {batch.matched} 人
                                    </td>
                                    <td>
                                        成功 {batch.issued} · 跳过{" "}
                                        {batch.skipped} · 失败 {batch.failed}
                                        <br />
                                        待发 {batch.pending} · 取消{" "}
                                        {batch.cancelled}
                                    </td>
                                    <td>
                                        {couponCampaignStatuses[batch.status] ||
                                            batch.status}
                                    </td>
                                    <td>
                                        <div className="actions">
                                            <button
                                                onClick={() =>
                                                    setSelected(batch)
                                                }
                                            >
                                                查看明细
                                            </button>
                                            {batch.status === "queued" && (
                                                <button
                                                    className="danger"
                                                    disabled={operation.busy}
                                                    onClick={() => {
                                                        operation.clear();
                                                        setCancelling(batch);
                                                    }}
                                                >
                                                    取消剩余发放
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    {!list.data?.length && (
                        <p className="pad muted">暂无发放批次。</p>
                    )}
                </div>
            </State>
            <Pager
                loading={list.loading}
                onSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                }}
                page={page}
                total={list.total}
                size={pageSize}
                onChange={setPage}
            />
            {selected && (
                <Modal
                    title={`批次 #${selected.id} 发放明细`}
                    close={() => setSelected(null)}
                >
                    <CouponRecipients id={selected.id} />
                </Modal>
            )}
            {cancelling && (
                <Modal
                    title="取消剩余发放"
                    close={() => {
                        if (!operation.busy) setCancelling(null);
                    }}
                >
                    <div className="pad">
                        <p>
                            批次 #{cancelling.id} · {cancelling.couponName}
                            ，当前待发 {cancelling.pending} 人。
                        </p>
                        <p>
                            仅取消尚未发出的部分并退回库存，已发出的券继续有效。
                        </p>
                        <AdminOperationNotice notice={operation.notice} />
                        <div className="actions">
                            <button
                                disabled={operation.busy}
                                onClick={() => setCancelling(null)}
                            >
                                继续发放
                            </button>
                            <button
                                className="danger"
                                disabled={operation.busy}
                                onClick={() =>
                                    void operation.run(async () => {
                                        await request(
                                            admin("coupon-campaign/cancel"),
                                            { id: cancelling.id },
                                        );
                                        list.reload();
                                        setCancelling(null);
                                        return "已取消剩余发放。";
                                    })
                                }
                            >
                                确认取消
                            </button>
                        </div>
                    </div>
                </Modal>
            )}
        </section>
    );
}

function CouponRecipients({ id }: { id: number }) {
    const [pageSize, setPageSize] = useState(50);
    const [page, setPage] = useState(1),
        [status, setStatus] = useState("");
    const data = useData<Row[]>(
        admin(
            `coupon-campaign/recipients?id=${id}&current=${page}&pageSize=${pageSize}&status=${status}`,
        ),
    );
    return (
        <div className="pad">
            <label>
                结果筛选
                <select
                    value={status}
                    onChange={(event) => {
                        setStatus(event.target.value);
                        setPage(1);
                    }}
                >
                    <option value="">全部</option>
                    {Object.entries(couponRecipientStatuses).map(
                        ([value, label]) => (
                            <option key={value} value={value}>
                                {label}
                            </option>
                        ),
                    )}
                </select>
            </label>
            <State {...data} retry={data.reload}>
                <div className="table-scroll">
                    <table>
                        <thead>
                            <tr>
                                <th>用户 ID</th>
                                <th>状态</th>
                                <th>结果</th>
                                <th>时间</th>
                            </tr>
                        </thead>
                        <tbody>
                            {data.data?.map((row) => (
                                <tr key={row.user_id}>
                                    <td>#{row.user_id}</td>
                                    <td>
                                        {couponRecipientStatuses[row.status] ||
                                            row.status}
                                    </td>
                                    <td>
                                        {couponRecipientReasons[row.reason] ||
                                            "—"}
                                    </td>
                                    <td>{formatInstant(row.updated_at)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </State>
            <Pager
                loading={data.loading}
                onSizeChange={(size) => {
                    setPageSize(size);
                    setPage(1);
                }}
                page={page}
                total={data.total}
                size={pageSize}
                onChange={setPage}
            />
        </div>
    );
}
