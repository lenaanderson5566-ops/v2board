import { lazy, useState } from "react";
import { e } from "../shared/experience-copy";
import { tx } from "../shared/i18n";
import { request, query, money, date, navigate, type Row } from "../shared/api";
import { useData, State, Panel, Table, Modal, Editor, Pager } from "../shared/ui";

const EmailInvites = lazy(() => import("./EmailInvites").then(module => ({ default: module.EmailInvites })));

export function Invite() {
    const [page, setPage] = useState(1);
    const [action, setAction] = useState<"transfer" | "withdraw" | null>(null);
    const config = useData("user/comm/config");
    const d = useData("user/invite/fetch"),
        details = useData<Row[]>(query("user/invite/details", {current: page, page_size: 20}));
    const v = d.data || {},
        stat = v.stat || [];
    return (
        <State {...d} retry={d.reload}>
            <div className="invite-page-content">
            <EmailInvites rewards={v.rewards} />
            <section className="invite-wallet">
                <div className="invite-wallet-balance">
                    <span className="muted">{tx("可用佣金")}</span>
                    <strong>{money(stat[4],v.currency)}</strong>
                    <div className="invite-wallet-facts">
                        <span>{tx("邀请用户")} <b>{stat[0] || 0}</b></span>
                        <span>{tx("佣金比例")} <b>{stat[3] || 0}%</b></span>
                    </div>
                </div>
                <div className="invite-wallet-actions">
                    <button className="primary" disabled={Number(stat[4] || 0) <= 0} onClick={() => setAction("transfer")}>{tx("转入余额")}</button>
                    {config.data && !config.data.withdraw_close && <button disabled={Number(stat[4] || 0) <= 0} onClick={() => setAction("withdraw")}>{tx("申请佣金提现")}</button>}
                </div>
            </section>
            <Panel className="invite-ledger" title={tx("佣金记录")}>
                <State {...details}>
                    <Table
                        data={details.data || []}
                        columns={[
                            ["trade_no", tx("订单")],
                            [
                                "order_amount",
                                tx("订单金额"),
                                (r) => money(r.order_amount,r.order_currency || r.currency),
                            ],
                            [
                                "get_amount",
                                tx("佣金"),
                                (r) => money(r.get_amount,r.currency),
                            ],
                            [
                                "created_at",
                                tx("时间"),
                                (r) => date(r.created_at),
                            ],
                        ]}
                    />
                </State>
            {details.total > 20 && <Pager page={page} total={details.total} size={20} onChange={setPage} />}
            </Panel>
            {action === "transfer" && <Modal title={tx("转入余额")} close={() => setAction(null)}>
                <div className="invite-money-form">
                <Editor
                    fields={[
                        {
                            key: "transfer_amount",
                            label: e("transferAmount", {
                                currency: v.currency,
                            }),
                            scale: 100,
                            min: 0.01,
                            step: 0.01,
                            type: "number",
                            required: true,
                        },
                    ]}
                    initial={{}}
                    submit={tx("转入余额")}
                    onSave={async (b) => {
                        await request("user/transfer", b);
                        d.reload();
                        setAction(null);
                    }}
                />
                </div>
            </Modal>}
            {action === "withdraw" && config.data && !config.data.withdraw_close && (
                <Modal title={tx("申请佣金提现")} close={() => setAction(null)}>
                    <div className="invite-money-form">
                    <Editor
                        fields={[
                            {
                                key: "withdraw_method",
                                label: tx("提现方式"),
                                type: "select",
                                options: (
                                    config.data.withdraw_methods || []
                                ).map((m: string) => [m, m]),
                            },
                            {
                                key: "withdraw_account",
                                label: tx("收款账户"),
                                required: true,
                            },
                        ]}
                        initial={{}}
                        submit={tx("提交提现申请")}
                        onSave={async (b) => {
                            await request("user/ticket/withdraw", b);
                            navigate("ticket");
                        }}
                    />
                    </div>
                </Modal>
            )}
            </div>
        </State>
    );
}
