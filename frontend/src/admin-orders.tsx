import { useState } from "react";
import { admin, request, query, money, date, type Row } from "./api";
import { useData, Modal, Editor, State, Table } from "./ui";
import { ResourcePage, resources } from "./admin";
import { AssignOrder } from "./admin-users";
export function OrdersPage() {
    const params = new URLSearchParams(
        window.location.hash.split("?")[1] || "",
    );
    const [filter, setFilter] = useState<Row[]>(() =>
        ["user_id", "invite_user_id", "commission_status", "status"]
            .filter((key) => params.has(key))
            .map((key) => ({ key, condition: "=", value: params.get(key) }))
            .concat(
                params.has("commission_balance_min")
                    ? [
                          {
                              key: "commission_balance",
                              condition: ">",
                              value: params.get("commission_balance_min"),
                          },
                      ]
                    : [],
            ),
    );
    const [draft, setDraft] = useState<Row[]>(filter),
        [showFilter, setShowFilter] = useState(false),
        [selected, setSelected] = useState<Row | null>(null),
        [assign, setAssign] = useState(false),
        [revision, setRevision] = useState(0),
        [commission, setCommission] = useState<Row | null>(null);
    const plans = useData<Row[]>(admin("plan/fetch"));
    return (
        <>
            <ResourcePage
                key={JSON.stringify({ filter, revision })}
                resource={resources.orders}
                searchable={false}
                queryParams={{ filter }}
                toolbar={
                    <div className="pad actions">
                        <button
                            onClick={() => {
                                setDraft(structuredClone(filter));
                                setShowFilter(true);
                            }}
                        >
                            高级筛选（{filter.length}）
                        </button>
                        <button
                            disabled={!filter.length}
                            onClick={() => setFilter([])}
                        >
                            清除筛选
                        </button>
                        <button
                            className="primary"
                            onClick={() => setAssign(true)}
                        >
                            分配订单
                        </button>
                    </div>
                }
                extraActions={(r) => (
                    <>
                        <button onClick={() => setSelected(r)}>订单详情</button>
                        <a
                            className="button"
                            href={`#/users?user_id=${r.user_id}`}
                        >
                            查看用户
                        </a>
                        <button
                            disabled={
                                r.status === 0 ||
                                r.status === 2 ||
                                !r.commission_balance ||
                                r.commission_status === 2
                            }
                            onClick={() => setCommission(r)}
                        >
                            佣金审核
                        </button>
                    </>
                )}
            />
            {showFilter && (
                <Modal title="订单高级筛选" close={() => setShowFilter(false)}>
                    <form
                        className="pad"
                        onSubmit={(e) => {
                            e.preventDefault();
                            setFilter(draft);
                            setShowFilter(false);
                        }}
                    >
                        {draft.map((f, i) => (
                            <div className="user-filter-row" key={i}>
                                <select
                                    aria-label={`订单筛选字段 ${i + 1}`}
                                    value={f.key}
                                    onChange={(e) =>
                                        setDraft(
                                            draft.map((x, j) =>
                                                j === i
                                                    ? {
                                                          key: e.target.value,
                                                          condition: "=",
                                                          value: "",
                                                      }
                                                    : x,
                                            ),
                                        )
                                    }
                                >
                                    {[
                                        ["email", "用户邮箱"],
                                        ["trade_no", "订单号"],
                                        ["status", "订单状态"],
                                        ["commission_status", "佣金状态"],
                                        ["user_id", "用户 ID"],
                                        ["invite_user_id", "邀请人 ID"],
                                        ["callback_no", "回调单号"],
                                        [
                                            "commission_balance",
                                            "佣金金额（分）",
                                        ],
                                    ].map(([k, l]) => (
                                        <option key={k} value={k}>
                                            {l}
                                        </option>
                                    ))}
                                </select>
                                <select
                                    aria-label={`订单筛选条件 ${i + 1}`}
                                    value={f.condition}
                                    onChange={(e) =>
                                        setDraft(
                                            draft.map((x, j) =>
                                                j === i
                                                    ? {
                                                          ...x,
                                                          condition:
                                                              e.target.value,
                                                      }
                                                    : x,
                                            ),
                                        )
                                    }
                                >
                                    {[
                                        "=",
                                        "模糊",
                                        ">",
                                        ">=",
                                        "<",
                                        "<=",
                                        "!=",
                                    ].map((x) => (
                                        <option key={x}>{x}</option>
                                    ))}
                                </select>
                                {["status", "commission_status"].includes(
                                    f.key,
                                ) ? (
                                    <select
                                        aria-label={`订单筛选值 ${i + 1}`}
                                        required
                                        value={f.value}
                                        onChange={(e) =>
                                            setDraft(
                                                draft.map((x, j) =>
                                                    j === i
                                                        ? {
                                                              ...x,
                                                              value: e.target
                                                                  .value,
                                                          }
                                                        : x,
                                                ),
                                            )
                                        }
                                    >
                                        <option value="">请选择</option>
                                        {(f.key === "status"
                                            ? [
                                                  "待支付",
                                                  "开通中",
                                                  "已取消",
                                                  "已完成",
                                                  "已折抵",
                                              ]
                                            : [
                                                  "待确认",
                                                  "有效",
                                                  "已发放",
                                                  "无效",
                                              ]
                                        ).map((l, k) => (
                                            <option key={k} value={k}>
                                                {l}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        aria-label={`订单筛选值 ${i + 1}`}
                                        required
                                        value={f.value}
                                        onChange={(e) =>
                                            setDraft(
                                                draft.map((x, j) =>
                                                    j === i
                                                        ? {
                                                              ...x,
                                                              value: e.target
                                                                  .value,
                                                          }
                                                        : x,
                                                ),
                                            )
                                        }
                                    />
                                )}
                                <button
                                    type="button"
                                    onClick={() =>
                                        setDraft(
                                            draft.filter((_, j) => j !== i),
                                        )
                                    }
                                >
                                    删除条件
                                </button>
                            </div>
                        ))}
                        <div className="actions">
                            <button
                                type="button"
                                onClick={() =>
                                    setDraft([
                                        ...draft,
                                        {
                                            key: "email",
                                            condition: "模糊",
                                            value: "",
                                        },
                                    ])
                                }
                            >
                                添加条件
                            </button>
                            <button type="button" onClick={() => setDraft([])}>
                                重置条件
                            </button>
                            <button className="primary">应用筛选</button>
                        </div>
                    </form>
                </Modal>
            )}
            {selected && (
                <Modal title="订单详情" close={() => setSelected(null)}>
                    <OrderDetail row={selected} />
                </Modal>
            )}
            {assign && (
                <Modal
                    title="分配订单"
                    close={() => {
                        setAssign(false);
                        setRevision((v) => v + 1);
                    }}
                >
                    <AssignOrder
                        row={{ email: "" }}
                        plans={plans.data || []}
                        loading={plans.loading}
                        error={plans.error}
                    />
                </Modal>
            )}
            {commission && (
                <Modal title="佣金审核" close={() => setCommission(null)}>
                    <p className="pad muted">
                        标记为有效后系统会处理发放；已发放佣金不可修改。
                    </p>
                    <Editor
                        fields={[
                            {
                                key: "commission_status",
                                label: "佣金状态",
                                type: "select",
                                required: true,
                                options: [
                                    ["0", "待确认"],
                                    ["1", "有效"],
                                    ["3", "无效"],
                                ],
                            },
                        ]}
                        initial={{
                            commission_status: commission.commission_status,
                        }}
                        onSave={async (b) => {
                            await request(admin("order/update"), {
                                ...b,
                                trade_no: commission.trade_no,
                            });
                            setCommission(null);
                            setRevision((v) => v + 1);
                        }}
                    />
                </Modal>
            )}
        </>
    );
}
function OrderDetail({ row }: { row: Row }) {
    const d = useData<Row>(admin("order/detail"), { id: row.id });
    const r = d.data;
    return (
        <div className="pad">
            <State {...d} retry={d.reload}>
                {r && (
                    <>
                        <dl className="detail-grid">
                            {[
                                ["trade_no", "订单号"],
                                ["user_id", "用户 ID"],
                                ["plan_id", "套餐 ID"],
                                ["period", "周期"],
                                ["callback_no", "回调单号"],
                                ["status", "订单状态"],
                                ["commission_status", "佣金状态"],
                                ...[
                                    "total_amount",
                                    "balance_amount",
                                    "discount_amount",
                                    "refund_amount",
                                    "surplus_amount",
                                    "commission_balance",
                                    "actual_commission_balance",
                                ].map((key, i) => [
                                    key,
                                    [
                                        "支付金额",
                                        "余额支付",
                                        "优惠金额",
                                        "退回金额",
                                        "折抵金额",
                                        "佣金金额",
                                        "实际佣金",
                                    ][i],
                                ]),
                                ["created_at", "创建时间"],
                                ["updated_at", "更新时间"],
                                ["paid_at", "支付时间"],
                            ].map(([key, label]) => (
                                <div key={key}>
                                    <dt>{label}</dt>
                                    <dd>
                                        {key.endsWith("_at")
                                            ? date(r[key])
                                            : key.includes("amount") ||
                                                key.includes("balance")
                                              ? money(r[key])
                                              : String(r[key] ?? "—")}
                                    </dd>
                                </div>
                            ))}
                        </dl>
                        <h3>佣金记录</h3>
                        <Table
                            data={r.commission_log || []}
                            columns={[
                                ["invite_user_id", "邀请人"],
                                [
                                    "get_amount",
                                    "金额",
                                    (x) => money(x.get_amount),
                                ],
                                [
                                    "created_at",
                                    "时间",
                                    (x) => date(x.created_at),
                                ],
                            ]}
                        />
                        <h3>折抵订单</h3>
                        <Table
                            data={r.surplus_orders || []}
                            columns={[
                                ["trade_no", "订单号"],
                                [
                                    "total_amount",
                                    "金额",
                                    (x) => money(x.total_amount),
                                ],
                            ]}
                        />
                        {r.invite_user_id && (
                            <a
                                href={`#/users?invite_user_id=${r.invite_user_id}`}
                            >
                                查看邀请人邀请的用户
                            </a>
                        )}
                    </>
                )}
            </State>
        </div>
    );
}
