import { useState } from "react";
import {
    admin,
    request,
    query,
    download,
    bytes,
    money,
    date,
    type Row,
} from "./api";
import { Modal, Editor, State, Table, Pager, useData } from "./ui";
import { ResourcePage, resources, GenerateUsers } from "./admin";
import {
    userFilterFields,
    userSortFields,
    normalizeUserFilters,
    emailSearchFilters,
    type UserFilter,
} from "./user-filters";

export function UsersPage() {
    const plans = useData<Row[]>(admin("plan/fetch"));
    const [filters, setFilters] = useState<UserFilter[]>([]),
        [email, setEmail] = useState(""),
        [showFilters, setShowFilters] = useState(false),
        [total, setTotal] = useState(0),
        [revision, setRevision] = useState(0),
        [error, setError] = useState(""),
        [notice, setNotice] = useState(""),
        [busy, setBusy] = useState(false),
        [pageSize, setPageSize] = useState(10),
        [sort, setSort] = useState("created_at"),
        [direction, setDirection] = useState("DESC");
    const [detail, setDetail] = useState<{ kind: string; row: Row } | null>(
            null,
        ),
        [generate, setGenerate] = useState(false),
        [bulk, setBulk] = useState<{
            kind: string;
            filters: UserFilter[];
            count: number;
        } | null>(null);
    const params = { filter: filters, sort, sort_type: direction };
    const refresh = () => setRevision((v) => v + 1);
    async function exportCsv() {
        setBusy(true);
        setError("");
        try {
            await download(admin("user/dumpCSV"), params, "users.csv");
            setNotice("CSV 已下载");
        } catch (e) {
            setError((e as Error).message);
        } finally {
            setBusy(false);
        }
    }
    async function copy(row: Row) {
        setError("");
        try {
            if (!row.subscribe_url) throw new Error("当前用户没有订阅链接");
            await navigator.clipboard.writeText(row.subscribe_url);
            setNotice(`已复制 ${row.email} 的订阅链接`);
        } catch (e) {
            setError((e as Error).message);
            setDetail({ kind: "link", row });
        }
    }
    return (
        <div className="users-page">
            <ResourcePage
                key={JSON.stringify({ params, pageSize, revision })}
                resource={resources.users}
                queryParams={params}
                pageSize={pageSize}
                searchable={false}
                onTotal={setTotal}
                toolbar={
                    <div className="pad user-toolbar">
                        <form
                            className="actions"
                            onSubmit={(e) => {
                                e.preventDefault();
                                setFilters(emailSearchFilters(filters, email));
                                setNotice("");
                            }}
                        >
                            <input
                                aria-label="搜索所有用户邮箱"
                                placeholder="搜索所有用户邮箱"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                            />
                            <button>搜索</button>
                            <button
                                type="button"
                                onClick={() => setShowFilters(true)}
                            >
                                高级筛选
                                {filters.length ? `（${filters.length}）` : ""}
                            </button>
                            <button
                                type="button"
                                disabled={!filters.length}
                                onClick={() => {
                                    setFilters([]);
                                    setEmail("");
                                    setNotice("");
                                }}
                            >
                                清除筛选
                            </button>
                        </form>
                        <div className="actions">
                            <button
                                disabled={busy || !total}
                                onClick={exportCsv}
                            >
                                导出 CSV
                            </button>
                            <button
                                disabled={!total}
                                onClick={() =>
                                    setBulk({
                                        kind: "mail",
                                        filters: structuredClone(filters),
                                        count: total,
                                    })
                                }
                            >
                                发送邮件
                            </button>
                            <button
                                disabled={!filters.length || !total}
                                onClick={() =>
                                    setBulk({
                                        kind: "ban",
                                        filters: structuredClone(filters),
                                        count: total,
                                    })
                                }
                            >
                                批量封禁
                            </button>
                            <button
                                className="danger"
                                disabled={!filters.length || !total}
                                onClick={() =>
                                    setBulk({
                                        kind: "delete",
                                        filters: structuredClone(filters),
                                        count: total,
                                    })
                                }
                            >
                                批量删除
                            </button>
                            <button
                                className="primary"
                                onClick={() => setGenerate(true)}
                            >
                                生成用户
                            </button>
                        </div>
                        <div className="actions">
                            <label>
                                排序字段{" "}
                                <select
                                    aria-label="用户排序字段"
                                    value={sort}
                                    onChange={(e) => setSort(e.target.value)}
                                >
                                    {userSortFields.map(([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ))}
                                </select>
                            </label>
                            <label>
                                顺序{" "}
                                <select
                                    aria-label="用户排序方向"
                                    value={direction}
                                    onChange={(e) =>
                                        setDirection(e.target.value)
                                    }
                                >
                                    <option value="DESC">降序</option>
                                    <option value="ASC">升序</option>
                                </select>
                            </label>
                            <label>
                                每页{" "}
                                <select
                                    aria-label="用户每页数量"
                                    value={pageSize}
                                    onChange={(e) =>
                                        setPageSize(Number(e.target.value))
                                    }
                                >
                                    {[10, 20, 50, 100, 150].map((n) => (
                                        <option key={n} value={n}>
                                            {n}
                                        </option>
                                    ))}
                                </select>
                            </label>
                        </div>
                        <p className="muted">
                            {filters.length
                                ? `当前筛选结果 ${total} 名用户；导出和批量操作使用全部匹配结果，不限当前页。`
                                : `共 ${total} 名用户；批量封禁和删除需要先设置筛选条件。`}
                        </p>
                        {filters.map((f, i) => (
                            <span className="filter-chip" key={i}>
                                {
                                    userFilterFields.find(
                                        ([key]) => key === f.key,
                                    )?.[1]
                                }{" "}
                                {f.condition}{" "}
                                {["uuid", "token"].includes(f.key)
                                    ? "已填写"
                                    : String(f.value)}{" "}
                                <button
                                    aria-label={`移除筛选条件 ${i + 1}`}
                                    onClick={() =>
                                        setFilters(
                                            filters.filter(
                                                (_, index) => index !== i,
                                            ),
                                        )
                                    }
                                >
                                    ×
                                </button>
                            </span>
                        ))}
                        {error && (
                            <p className="alert" role="alert">
                                {error}
                            </p>
                        )}
                        {notice && <p role="status">{notice}</p>}
                    </div>
                }
                extraActions={(row) => (
                    <details className="row-menu">
                        <summary>更多操作</summary>
                        <div className="row-menu-content">
                            <button
                                onClick={() =>
                                    setDetail({ kind: "assign", row })
                                }
                            >
                                分配订单
                            </button>
                            <button onClick={() => copy(row)}>
                                复制订阅链接
                            </button>
                            <button
                                onClick={() =>
                                    setDetail({ kind: "orders", row })
                                }
                            >
                                TA 的订单
                            </button>
                            <button
                                onClick={() => {
                                    setFilters([
                                        {
                                            key: "invite_user_id",
                                            condition: "=",
                                            value: row.id,
                                        },
                                    ]);
                                    setEmail("");
                                    setNotice(
                                        `正在查看 ${row.email} 邀请的用户`,
                                    );
                                }}
                            >
                                TA 的邀请
                            </button>
                            <button
                                onClick={() =>
                                    setDetail({ kind: "traffic", row })
                                }
                            >
                                TA 的流量记录
                            </button>
                        </div>
                    </details>
                )}
            />
            {showFilters && (
                <Modal title="用户高级筛选" close={() => setShowFilters(false)}>
                    <UserFilters
                        initial={filters}
                        plans={plans.data || []}
                        onApply={(next) => {
                            setFilters(next);
                            setNotice("");
                            setEmail(
                                String(
                                    next.find((f) => f.key === "email")
                                        ?.value || "",
                                ),
                            );
                            setShowFilters(false);
                        }}
                    />
                </Modal>
            )}
            {generate && (
                <Modal title="生成用户" close={() => setGenerate(false)}>
                    <GenerateUsers
                        onCreated={() => {
                            setGenerate(false);
                            refresh();
                            setNotice("用户已生成");
                        }}
                    />
                </Modal>
            )}
            {bulk && (
                <Modal
                    title={
                        bulk.kind === "mail"
                            ? "发送用户邮件"
                            : bulk.kind === "ban"
                              ? "批量封禁用户"
                              : "批量删除用户"
                    }
                    close={() => setBulk(null)}
                >
                    <BulkUsers
                        operation={bulk}
                        onComplete={() => {
                            setBulk(null);
                            refresh();
                            setNotice(
                                bulk.kind === "mail"
                                    ? "邮件已加入发送队列"
                                    : "批量操作已完成",
                            );
                        }}
                    />
                </Modal>
            )}
            {detail && (
                <Modal
                    title={`${detail.row.email} · ${{ assign: "分配订单", orders: "订单", traffic: "流量记录", link: "订阅链接" }[detail.kind as "assign"] || ""}`}
                    close={() => setDetail(null)}
                >
                    {detail.kind === "assign" ? (
                        <AssignOrder
                            row={detail.row}
                            plans={plans.data || []}
                            loading={plans.loading}
                            error={plans.error}
                        />
                    ) : detail.kind === "orders" ? (
                        <UserOrders row={detail.row} />
                    ) : detail.kind === "traffic" ? (
                        <UserTraffic row={detail.row} />
                    ) : (
                        <div className="pad">
                            <p>复制失败时，可手动选择以下链接。</p>
                            <textarea
                                aria-label="用户订阅链接"
                                readOnly
                                value={detail.row.subscribe_url || ""}
                            />
                        </div>
                    )}
                </Modal>
            )}
        </div>
    );
}
function UserFilters({
    initial,
    plans,
    onApply,
}: {
    initial: UserFilter[];
    plans: Row[];
    onApply: (filters: UserFilter[]) => void;
}) {
    const [draft, setDraft] = useState(
            initial.map((f) =>
                f.key === "expired_at"
                    ? {
                          ...f,
                          value: new Date(
                              Number(f.value) * 1000 -
                                  new Date().getTimezoneOffset() * 60000,
                          )
                              .toISOString()
                              .slice(0, 16),
                      }
                    : { ...f },
            ),
        ),
        [error, setError] = useState("");
    function change(index: number, value: Partial<UserFilter>) {
        setDraft(draft.map((f, i) => (i === index ? { ...f, ...value } : f)));
        setError("");
    }
    return (
        <form
            className="pad user-filters"
            onSubmit={(e) => {
                e.preventDefault();
                try {
                    onApply(normalizeUserFilters(draft));
                } catch (err) {
                    setError((err as Error).message);
                }
            }}
        >
            <p className="muted">
                多个条件同时满足。流量单位为 GB，到期时间按本地时间输入。
            </p>
            {draft.map((f, i) => {
                const spec = userFilterFields.find(([key]) => key === f.key)!;
                const options =
                    f.key === "plan_id"
                        ? [
                              ["null", "无套餐"],
                              ...plans.map((p) => [String(p.id), p.name]),
                          ]
                        : f.key === "banned"
                          ? [
                                ["0", "正常"],
                                ["1", "封禁"],
                            ]
                          : f.key === "is_admin"
                            ? [
                                  ["0", "否"],
                                  ["1", "是"],
                              ]
                            : null;
                return (
                    <div className="user-filter-row" key={i}>
                        <select
                            aria-label={`筛选字段 ${i + 1}`}
                            value={f.key}
                            onChange={(e) => {
                                const key = e.target.value;
                                change(i, {
                                    key,
                                    condition: userFilterFields.find(
                                        ([k]) => k === key,
                                    )![2][0],
                                    value: ["banned", "is_admin"].includes(key)
                                        ? "0"
                                        : key === "plan_id"
                                          ? "null"
                                          : "",
                                });
                            }}
                        >
                            {userFilterFields.map(([key, label]) => (
                                <option key={key} value={key}>
                                    {label}
                                </option>
                            ))}
                        </select>
                        <select
                            aria-label={`筛选条件 ${i + 1}`}
                            value={f.condition}
                            onChange={(e) =>
                                change(i, { condition: e.target.value })
                            }
                        >
                            {spec[2].map((c) => (
                                <option key={c}>{c}</option>
                            ))}
                        </select>
                        {options ? (
                            <select
                                aria-label={`筛选值 ${i + 1}`}
                                value={f.value}
                                onChange={(e) =>
                                    change(i, { value: e.target.value })
                                }
                            >
                                {options.map(([v, l]) => (
                                    <option value={v} key={v}>
                                        {l}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <input
                                aria-label={`筛选值 ${i + 1}`}
                                type={
                                    f.key === "expired_at"
                                        ? "datetime-local"
                                        : ["uuid", "token"].includes(f.key)
                                          ? "password"
                                          : [
                                                  "id",
                                                  "transfer_enable",
                                                  "device_limit",
                                                  "d",
                                                  "invite_user_id",
                                              ].includes(f.key)
                                            ? "number"
                                            : "text"
                                }
                                min="0"
                                step="any"
                                required
                                value={f.value}
                                onChange={(e) =>
                                    change(i, { value: e.target.value })
                                }
                            />
                        )}
                        <button
                            type="button"
                            aria-label={`删除筛选条件 ${i + 1}`}
                            onClick={() =>
                                setDraft(
                                    draft.filter((_, index) => index !== i),
                                )
                            }
                        >
                            删除条件
                        </button>
                    </div>
                );
            })}
            <div className="actions">
                <button
                    type="button"
                    onClick={() =>
                        setDraft([
                            ...draft,
                            { key: "email", condition: "模糊", value: "" },
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
            {error && (
                <p className="alert" role="alert">
                    {error}
                </p>
            )}
        </form>
    );
}
function BulkUsers({
    operation,
    onComplete,
}: {
    operation: { kind: string; filters: UserFilter[]; count: number };
    onComplete: () => void;
}) {
    const [confirmed, setConfirmed] = useState(false);
    const endpoint =
        operation.kind === "mail"
            ? admin("user/sendMail")
            : operation.kind === "ban"
              ? admin("user/ban")
              : admin("user/allDel");
    return (
        <div className="pad">
            <p>
                此次操作影响{operation.filters.length ? "当前筛选结果" : "全部"}
                的 <strong>{operation.count}</strong> 名用户。
            </p>
            <p className="muted">
                {operation.kind === "delete"
                    ? "用户及关联订单、邀请码和工单会被永久删除。"
                    : operation.kind === "ban"
                      ? "账户将被封禁，已有登录会话会被注销。"
                      : "邮件将进入群发队列，发送进度取决于队列和 SMTP 配置。"}
            </p>
            <label>
                <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                我已确认操作范围和人数
            </label>
            <Editor
                fields={
                    operation.kind === "mail"
                        ? [
                              {
                                  key: "subject",
                                  label: "邮件主题",
                                  required: true,
                              },
                              {
                                  key: "content",
                                  label: "邮件正文 HTML",
                                  type: "textarea",
                                  required: true,
                              },
                          ]
                        : []
                }
                initial={{}}
                validate={() =>
                    confirmed ? undefined : "请先确认操作范围和人数"
                }
                submit={
                    operation.kind === "mail"
                        ? "加入发送队列"
                        : operation.kind === "ban"
                          ? "确认封禁"
                          : "确认永久删除"
                }
                onSave={async (body) => {
                    await request(endpoint, {
                        ...body,
                        filter: operation.filters,
                        expected_count: operation.count,
                    });
                    onComplete();
                }}
            />
        </div>
    );
}
const periods: [string, string][] = [
    ["month_price", "月付"],
    ["quarter_price", "季付"],
    ["half_year_price", "半年付"],
    ["year_price", "年付"],
    ["two_year_price", "两年付"],
    ["three_year_price", "三年付"],
    ["onetime_price", "一次性"],
    ["reset_price", "重置流量"],
];
function AssignOrder({
    row,
    plans,
    loading,
    error,
}: {
    row: Row;
    plans: Row[];
    loading: boolean;
    error: string;
}) {
    const [trade, setTrade] = useState("");
    const eligible = plans.filter((p) =>
        periods.some(([key]) => p[key] != null),
    );
    const first = eligible.find((p) => p.id === row.plan_id) || eligible[0];
    const period = periods.find(([key]) => first?.[key] != null)?.[0];
    return (
        <State loading={loading} error={error}>
            {trade ? (
                <p className="pad" role="status">
                    已创建待支付订单：{trade}
                </p>
            ) : !eligible.length ? (
                <p className="pad" role="status">
                    暂无包含有效价格周期的套餐。请先在{" "}
                    <a href="#/plans">套餐管理</a> 中设置套餐价格。
                </p>
            ) : (
                <>
                    <p className="pad muted">
                        为此用户创建待支付订单，不会自动付款或立即开通套餐。
                    </p>
                    <Editor
                        fields={[
                            {
                                key: "email",
                                label: "用户邮箱",
                                type: "email",
                                required: true,
                            },
                            {
                                key: "plan_id",
                                label: "套餐",
                                type: "select",
                                required: true,
                                options: eligible.map((p) => [
                                    String(p.id),
                                    p.name,
                                ]),
                            },
                            {
                                key: "period",
                                label: "周期",
                                type: "select",
                                required: true,
                                options: periods,
                            },
                            {
                                key: "total_amount",
                                label: "订单金额（分）",
                                type: "number",
                                min: 0,
                                step: 1,
                                required: true,
                            },
                        ]}
                        initial={{
                            email: row.email,
                            plan_id: first?.id,
                            period,
                            total_amount: period ? first?.[period] : 0,
                        }}
                        resolveFields={(fields, values) =>
                            fields.map((f) =>
                                f.key === "period"
                                    ? {
                                          ...f,
                                          options: periods.filter(
                                              ([key]) =>
                                                  eligible.find(
                                                      (p) =>
                                                          String(p.id) ===
                                                          String(
                                                              values.plan_id,
                                                          ),
                                                  )?.[key] != null,
                                          ),
                                      }
                                    : f,
                            )
                        }
                        linkValues={(key, next, values) => {
                            const p = eligible.find(
                                (p) =>
                                    String(p.id) ===
                                    String(
                                        key === "plan_id"
                                            ? next
                                            : values.plan_id,
                                    ),
                            );
                            const selected =
                                key === "period"
                                    ? String(next)
                                    : key === "plan_id"
                                      ? periods.find(
                                            ([k]) => p?.[k] != null,
                                        )?.[0]
                                      : values.period;
                            return {
                                ...values,
                                [key]: next,
                                ...(["plan_id", "period"].includes(key)
                                    ? {
                                          period: selected,
                                          total_amount:
                                              p?.[selected || ""] ?? 0,
                                      }
                                    : {}),
                            };
                        }}
                        validate={() =>
                            eligible.length
                                ? undefined
                                : "请先创建含有效价格周期的套餐"
                        }
                        onSave={async (body) => {
                            setTrade(
                                String(
                                    (await request(admin("order/assign"), body))
                                        .data,
                                ),
                            );
                        }}
                    />
                </>
            )}
        </State>
    );
}
function UserOrders({ row }: { row: Row }) {
    const [page, setPage] = useState(1),
        [selected, setSelected] = useState<Row | null>(null);
    const d = useData<Row[]>(
        query(admin("order/fetch"), {
            current: page,
            pageSize: 10,
            filter: [{ key: "user_id", condition: "=", value: row.id }],
        }),
    );
    const detail = useData(
        selected ? admin("order/detail") : "",
        selected ? { id: selected.id } : undefined,
    );
    return (
        <div className="pad">
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["trade_no", "订单号"],
                        ["plan_name", "套餐"],
                        ["total_amount", "金额", (r) => money(r.total_amount)],
                        [
                            "status",
                            "状态",
                            (r) =>
                                [
                                    "待支付",
                                    "开通中",
                                    "已取消",
                                    "已完成",
                                    "已折抵",
                                ][r.status],
                        ],
                        ["created_at", "创建时间", (r) => date(r.created_at)],
                    ]}
                    actions={(r) => (
                        <button onClick={() => setSelected(r)}>订单详情</button>
                    )}
                />
                <Pager
                    page={page}
                    total={d.total}
                    size={10}
                    onChange={setPage}
                />
            </State>
            {selected && (
                <section>
                    <h3>订单详情</h3>
                    <button onClick={() => setSelected(null)}>收起详情</button>
                    <State {...detail} retry={detail.reload}>
                        <Table
                            data={detail.data ? [detail.data] : []}
                            columns={[
                                ["trade_no", "订单号"],
                                ["period", "周期"],
                                [
                                    "total_amount",
                                    "订单金额",
                                    (r) => money(r.total_amount),
                                ],
                                [
                                    "balance_amount",
                                    "余额抵扣",
                                    (r) => money(r.balance_amount),
                                ],
                                [
                                    "commission_balance",
                                    "佣金",
                                    (r) => money(r.commission_balance),
                                ],
                                ["paid_at", "付款时间", (r) => date(r.paid_at)],
                            ]}
                        />
                        <h4>佣金记录</h4>
                        <Table
                            data={detail.data?.commission_log || []}
                            columns={[
                                ["invite_user_id", "邀请人 ID"],
                                [
                                    "get_amount",
                                    "金额",
                                    (r) => money(r.get_amount),
                                ],
                                [
                                    "created_at",
                                    "时间",
                                    (r) => date(r.created_at),
                                ],
                            ]}
                        />
                    </State>
                </section>
            )}
        </div>
    );
}
function UserTraffic({ row }: { row: Row }) {
    const [page, setPage] = useState(1);
    const d = useData<Row[]>(
        query(admin("stat/getStatUser"), {
            user_id: row.id,
            current: page,
            pageSize: 10,
        }),
    );
    return (
        <div className="pad">
            <State {...d} retry={d.reload}>
                <Table
                    data={d.data || []}
                    columns={[
                        ["record_at", "日期", (r) => date(r.record_at)],
                        ["u", "上传", (r) => bytes(r.u)],
                        ["d", "下载", (r) => bytes(r.d)],
                        ["server_rate", "倍率"],
                    ]}
                />
                <Pager
                    page={page}
                    total={d.total}
                    size={10}
                    onChange={setPage}
                />
            </State>
        </div>
    );
}
