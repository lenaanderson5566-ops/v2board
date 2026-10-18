import { AdminFilterBar } from "./AdminFilterBar";
import { readListView, saveListView } from "./list-view-state";
import { PaymentCallbackHistory } from "./PaymentCallbackHistory";
import { adminStatusCell } from "../shared/admin-status";
import { adminUserLabel } from "./admin-user-label";
import { useEffect, useState } from "react";
import { admin, request, money, date, type Row } from "../shared/api";
import { useData, Modal, Editor, State, Table } from "../shared/ui";
import { ResourcePage, resources } from "./admin";
import { AssignOrder } from "./admin-users";
const commissionResource = {
    ...resources.orders,
    title: "佣金审核",
    actions: [],
    columns: [
        [
            "total_amount",
            "订单应付",
            (r: Row) => money(r.total_amount, r.currency),
        ] as (typeof resources.orders.columns)[number],
        [
            "paid_at",
            "支付时间",
            (r: Row) => (r.paid_at ? date(r.paid_at) : "无记录"),
        ] as (typeof resources.orders.columns)[number],
        ...resources.orders.columns.filter(([key]) =>
            [
                "trade_no",
                "user_id",
                "plan_name",
                "status",
                "commission_balance",
                "commission_status",
                "created_at",
            ].includes(key),
        ),
        [
            "invite_user_id",
            "邀请人（ID / 邮箱）",
            (r: Row) =>
                adminUserLabel({
                    user_id: r.invite_user_id,
                    email: r.invite_email,
                }),
        ] as (typeof resources.orders.columns)[number],
    ],
};
export function OrdersPage({
    commissionMode = false,
}: {
    commissionMode?: boolean;
}) {
    const params = new URLSearchParams(
        window.location.hash.split("?")[1] || "",
    );
    const explicitFilters = params.size > 0;
    if (commissionMode && !params.has("commission_status"))
        params.set("commission_status", "0");
    const orderViewKey = commissionMode
        ? "commission-filters"
        : "order-filters";
    const [filter, setFilter] = useState<Row[]>(() =>
        !commissionMode &&
        !explicitFilters &&
        Array.isArray(readListView(orderViewKey).filters)
            ? readListView(orderViewKey).filters.filter(
                  (item: Row) =>
                      item &&
                      typeof item.key === "string" &&
                      typeof item.condition === "string" &&
                      [
                          "email",
                          "trade_no",
                          "status",
                          "commission_status",
                          "user_id",
                          "invite_user_id",
                          "callback_no",
                          "commission_balance",
                      ].includes(item.key),
              )
            : ["user_id", "invite_user_id", "commission_status", "status"]
                  .filter((key) => params.has(key) && params.get(key) !== "")
                  .map((key) => ({
                      key,
                      condition: "=",
                      value: params.get(key),
                  }))
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
    useEffect(() => {
        saveListView(orderViewKey, { filters: filter });
    }, [orderViewKey, filter]);
    const [draft, setDraft] = useState<Row[]>(filter),
        [showFilter, setShowFilter] = useState(false),
        [selected, setSelected] = useState<Row | null>(null),
        [assign, setAssign] = useState(false),
        [revision, setRevision] = useState(0),
        [commission, setCommission] = useState<Row | null>(null);
    const [searchField, setSearchField] = useState("invite_email");
    const [searchText, setSearchText] = useState("");
    const plans = useData<Row[]>(admin("plan/fetch"));
    return (
        <>
            <ResourcePage
                key={JSON.stringify({ filter, revision })}
                resource={
                    commissionMode ? commissionResource : resources.orders
                }
                hiddenColumns={
                    commissionMode
                        ? []
                        : ["commission_balance", "commission_status"]
                }
                searchable={false}
                queryParams={{
                    filter,
                    ...(commissionMode ? { is_commission: 1 } : {}),
                }}
                toolbar={
                    <div className="pad actions">
                        {commissionMode && (
                            <label>
                                佣金状态{" "}
                                <select
                                    aria-label="佣金状态筛选"
                                    value={String(
                                        filter.find(
                                            (r) =>
                                                r.key === "commission_status",
                                        )?.value ?? "",
                                    )}
                                    onChange={(e) =>
                                        setFilter([
                                            ...filter.filter(
                                                (r) =>
                                                    r.key !==
                                                    "commission_status",
                                            ),
                                            ...(e.target.value === ""
                                                ? []
                                                : [
                                                      {
                                                          key: "commission_status",
                                                          condition: "=",
                                                          value: e.target.value,
                                                      },
                                                  ]),
                                        ])
                                    }
                                >
                                    <option value="">全部</option>
                                    <option value="0">待确认</option>
                                    <option value="1">有效</option>
                                    <option value="2">已发放</option>
                                    <option value="3">无效</option>
                                </select>
                            </label>
                        )}
                        {commissionMode && (
                            <AdminFilterBar

                                onSubmit={(event) => {
                                    event.preventDefault();
                                    setFilter([
                                        ...filter.filter(
                                            (item) =>
                                                item.key ===
                                                "commission_status",
                                        ),
                                        ...(searchText.trim()
                                            ? [
                                                  {
                                                      key: searchField,
                                                      condition: "=",
                                                      value: searchText.trim(),
                                                  },
                                              ]
                                            : []),
                                    ]);
                                }}
                            >
                                <select
                                    aria-label="佣金查询字段"
                                    value={searchField}
                                    onChange={(event) =>
                                        setSearchField(event.target.value)
                                    }
                                >
                                    <option value="invite_email">
                                        邀请人邮箱
                                    </option>
                                    <option value="email">受邀用户邮箱</option>
                                    <option value="trade_no">订单号</option>
                                    <option value="invite_user_id">
                                        邀请人 ID
                                    </option>
                                    <option value="user_id">受邀用户 ID</option>
                                </select>
                                <input
                                    aria-label="佣金查询内容"
                                    placeholder="输入完整邮箱、订单号或 ID"
                                    value={searchText}
                                    onChange={(event) =>
                                        setSearchText(event.target.value)
                                    }
                                />
                                <button type="submit">查询</button>
                            </AdminFilterBar>
                        )}
                        {!commissionMode && (
                            <button
                                onClick={() => {
                                    setDraft(structuredClone(filter));
                                    setShowFilter(true);
                                }}
                            >
                                高级筛选（{filter.length}）
                            </button>
                        )}
                        <button
                            disabled={!filter.length}
                            onClick={() => {
                                setFilter([]);
                                setSearchText("");
                            }}
                        >
                            清除筛选
                        </button>
                        {!commissionMode && (
                            <button
                                className="primary"
                                onClick={() => setAssign(true)}
                            >
                                分配订单
                            </button>
                        )}
                        {commissionMode && (
                            <p className="muted commission-filter-summary">
                                仅展示有佣金的已付款订单。当前查询：
                                {filter
                                    .filter(
                                        (item) =>
                                            item.key !== "commission_status",
                                    )
                                    .map(
                                        (item) =>
                                            `${({ invite_email: "邀请人邮箱", email: "受邀用户邮箱", trade_no: "订单号", invite_user_id: "邀请人 ID", user_id: "受邀用户 ID", status: "订单状态", commission_balance: "佣金金额" } as Row)[item.key] || item.key} ${item.condition} ${item.value}`,
                                    )
                                    .join(" · ") || "不限用户及订单"}
                            </p>
                        )}
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
                        {commissionMode && (
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
                        )}
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
                                    ]
                                        .filter(
                                            ([key]) =>
                                                commissionMode ||
                                                !key.startsWith("commission_"),
                                        )
                                        .map(([k, l]) => (
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
                    <OrderDetail
                        row={selected}
                        commissionMode={commissionMode}
                    />
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
                    <CommissionReview
                        row={commission}
                        saved={() => {
                            setCommission(null);
                            setRevision((v) => v + 1);
                        }}
                    />
                </Modal>
            )}
        </>
    );
}
function OrderDetail({
    row,
    commissionMode,
}: {
    row: Row;
    commissionMode: boolean;
}) {
    const d = useData<Row>(admin("order/detail"), { id: row.id });
    const r = d.data;
    return (
        <div className="pad">
            <State {...d} retry={d.reload}>
                {r && (
                    <>
                        <PaymentCallbackHistory history={r.callback_history} />
                        <dl className="detail-grid">
                            {[
                                ["trade_no", "订单号"],
                                ["user_id", "用户（ID / 邮箱）"],
                                ["plan_id", "套餐 ID"],
                                ["period", "周期"],
                                ["callback_no", "回调单号"],
                                ["payment_display", "支付方式"],
                                ["payment_provider", "支付接口"],
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
                            ]
                                .filter(
                                    ([key]) =>
                                        commissionMode ||
                                        !key.includes("commission"),
                                )
                                .map(([key, label]) => (
                                    <div key={key}>
                                        <dt>{label}</dt>
                                        <dd>
                                            {key.endsWith("_at")
                                                ? date(r[key])
                                                : key.includes("amount") ||
                                                    key.includes("balance")
                                                  ? money(r[key], r.currency)
                                                  : key === "user_id"
                                                    ? adminUserLabel(r)
                                                    : adminStatusCell(
                                                          key,
                                                          label,
                                                          r[key],
                                                      )}
                                        </dd>
                                    </div>
                                ))}
                        </dl>
                        {commissionMode && (
                            <>
                                <h3>佣金记录</h3>
                                <Table
                                    data={r.commission_log || []}
                                    columns={[
                                        [
                                            "invite_user_id",
                                            "邀请人（ID / 邮箱）",
                                            (r) =>
                                                adminUserLabel({
                                                    user_id: r.invite_user_id,
                                                    email: r.invite_email,
                                                }),
                                        ],
                                        [
                                            "get_amount",
                                            "金额",
                                            (x) =>
                                                money(x.get_amount, x.currency),
                                        ],
                                        [
                                            "created_at",
                                            "时间",
                                            (x) => date(x.created_at),
                                        ],
                                    ]}
                                />
                            </>
                        )}
                        <h3>折抵订单</h3>
                        <Table
                            data={r.surplus_orders || []}
                            columns={[
                                ["trade_no", "订单号"],
                                [
                                    "total_amount",
                                    "金额",
                                    (x) => money(x.total_amount, x.currency),
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

function CommissionReview({ row, saved }: { row: Row; saved: () => void }) {
    const detail = useData<Row>(admin("order/detail"), { id: row.id });
    const order = detail.data;
    const review = order?.invitation_review;
    const states: Row = {
        pending: "待人工复核",
        confirmed: "确认违规",
        false_positive: "排除疑似",
        insufficient: "证据不足",
        no_signal: "未命中审核条件",
    };
    const signal = (value: unknown) =>
        value === true ? "相同" : value === false ? "不同" : "无记录";
    return (
        <State {...detail} retry={detail.reload}>
            {order && (
                <>
                    <div className="pad commission-review-context">
                        <dl>
                            <div>
                                <dt>邀请人</dt>
                                <dd>
                                    <a
                                        href={`#/users?user_id=${order.invite_user_id}`}
                                    >
                                        {adminUserLabel({
                                            user_id: order.invite_user_id,
                                            email: order.invite_email,
                                        })}
                                    </a>
                                </dd>
                            </div>
                            <div>
                                <dt>受邀用户</dt>
                                <dd>
                                    <a
                                        href={`#/users?user_id=${order.user_id}`}
                                    >
                                        {adminUserLabel(order)}
                                    </a>
                                </dd>
                            </div>
                            <div>
                                <dt>订单号</dt>
                                <dd>{order.trade_no}</dd>
                            </div>
                            <div>
                                <dt>套餐（当前名称）</dt>
                                <dd>{order.plan_name || "套餐不可用"}</dd>
                            </div>
                            <div>
                                <dt>订单状态</dt>
                                <dd>
                                    {[
                                        "待支付",
                                        "开通中",
                                        "已取消",
                                        "已完成",
                                        "已折抵",
                                    ][Number(order.status)] || "未知"}
                                </dd>
                            </div>
                            <div>
                                <dt>支付时间</dt>
                                <dd>
                                    {order.paid_at
                                        ? date(order.paid_at)
                                        : "无记录"}
                                </dd>
                            </div>
                            <div>
                                <dt>订单应付</dt>
                                <dd>
                                    {money(order.total_amount, order.currency)}
                                </dd>
                            </div>
                            <div>
                                <dt>余额抵扣</dt>
                                <dd>
                                    {money(
                                        order.balance_amount || 0,
                                        order.currency,
                                    )}
                                </dd>
                            </div>
                            <div>
                                <dt>待审核佣金</dt>
                                <dd>
                                    <strong>
                                        {money(
                                            order.commission_balance,
                                            order.currency,
                                        )}
                                    </strong>
                                </dd>
                            </div>
                            <div>
                                <dt>当前佣金状态</dt>
                                <dd>
                                    {["待确认", "有效", "已发放", "无效"][
                                        Number(order.commission_status)
                                    ] || "未知"}
                                </dd>
                            </div>
                            <div>
                                <dt>邀请人工复核</dt>
                                <dd>
                                    {review
                                        ? states[review.state] || "未知"
                                        : "无复核记录"}
                                </dd>
                            </div>
                            <div>
                                <dt>注册来源</dt>
                                <dd>
                                    IP：
                                    {signal(
                                        review?.signals?.sameRegistrationIp,
                                    )}{" "}
                                    · UA：
                                    {signal(
                                        review?.signals?.sameRegistrationUa,
                                    )}
                                </dd>
                            </div>
                        </dl>
                        <p className="muted">
                            同 IP、UA
                            仅为线索，不代表同一人。邀请复核与佣金状态分别处理；标记有效后系统将按规则处理发放。
                        </p>
                        <a href={`#/invitations?tab=reviews`}>
                            查看邀请人工复核
                        </a>
                    </div>
                    {[0, 2].includes(Number(order.status)) ||
                    !Number(order.commission_balance) ||
                    Number(order.commission_status) === 2 ? (
                        <p className="pad muted">
                            当前佣金不可修改，请刷新列表查看最新状态。
                        </p>
                    ) : (
                        <Editor
                            fields={[
                                {
                                    key: "commission_status",
                                    label: "审核结果",
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
                                commission_status: order.commission_status,
                            }}
                            onSave={async (body) => {
                                if (
                                    String(body.commission_status) === "1" &&
                                    review?.state === "confirmed" &&
                                    !window.confirm(
                                        "邀请复核已确认违规，仍要将该佣金标记为有效？",
                                    )
                                )
                                    return;
                                await request(admin("order/update"), {
                                    ...body,
                                    trade_no: order.trade_no,
                                });
                                saved();
                            }}
                        />
                    )}
                </>
            )}
        </State>
    );
}
