import { AdminUserDetails } from "./AdminUserDetails";
import { AdminDisplaySettings } from "./AdminDisplaySettings";
import { UserFilters } from "./UserFilters";
import { adminUserLabel } from "./admin-user-label";
import { AdminMailComposer } from "./AdminMailComposer";
import { useEffect, useState, useRef } from "react";
import { AdminUsageReset } from "./AdminUsageReset";
import { AdminRowMenu } from "./AdminRowMenu";
import {
    admin,
    request,
    type Row,
} from "../shared/api";
import { Modal, Editor, State, useData } from "../shared/ui";
import { ResourcePage, resources } from "./admin";
import {
    userFilterFields,
    userSortFields,
    emailSearchFilters,
    type UserFilter,
} from "./user-filters";

const userViewKey = "admin.users.view.v1";
function savedUserView(): Record<string, any> {
    try {
        const value = JSON.parse(localStorage.getItem(userViewKey) || "{}");
        return value && typeof value === "object" ? value : {};
    } catch {
        return {};
    }
}
const defaultUserColumns = () =>
    resources.users.columns
        .map(([key]) => key)
        .filter(
            (key) =>
                !["commission_balance", "group_id", "device_limit"].includes(
                    key,
                ),
        );
export function UsersPage() {
    const [saved] = useState(savedUserView);
    const [optionalColumns, setOptionalColumns] = useState<string[]>(() =>
        Array.isArray(saved.columns)
            ? saved.columns.filter((key: string) =>
                  resources.users.columns.some(([id]) => id === key),
              )
            : defaultUserColumns(),
    );
    const plans = useData<Row[]>(admin("plan/fetch"));
    const [filters, setFilters] = useState<UserFilter[]>(() => {
            const params = new URLSearchParams(
                window.location.hash.split("?")[1] || "",
            );
            return params.has("user_id")
                ? [{ key: "id", condition: "=", value: params.get("user_id")! }]
                : params.has("invite_user_id")
                  ? [
                        {
                            key: "invite_user_id",
                            condition: "=",
                            value: params.get("invite_user_id")!,
                        },
                    ]
                  : [];
        }),
        [email, setEmail] = useState(""),
        [showFilters, setShowFilters] = useState(false),
        [showDisplay, setShowDisplay] = useState(false),
        [total, setTotal] = useState(0),
        [revision, setRevision] = useState(0),
        [error, setError] = useState(""),
        [notice, setNotice] = useState(""),
        [pageSize, setPageSize] = useState(
            [10, 20, 50, 100].includes(saved.pageSize) ? saved.pageSize : 10,
        ),
        [sort, setSort] = useState(
            userSortFields.some(([key]) => key === saved.sort)
                ? saved.sort
                : "created_at",
        ),
        [direction, setDirection] = useState(
            saved.direction === "ASC" ? "ASC" : "DESC",
        );
    useEffect(() => {
        setEmail(String(filters.find(item => item.key === "email")?.value || ""));
    }, [filters]);
    useEffect(() => {
        try {
            localStorage.setItem(
                userViewKey,
                JSON.stringify({
                    columns: optionalColumns,
                    pageSize,
                    sort,
                    direction,
                }),
            );
        } catch {
            /* Storage may be disabled. */
        }
    }, [optionalColumns, pageSize, sort, direction]);
    const [detail, setDetail] = useState<{ kind: string; row: Row } | null>(
            null,
        ),
        [bulk, setBulk] = useState<{
            kind: string;
            filters: UserFilter[];
            count: number;
        } | null>(null);
    const params = { filter: filters, sort, sort_type: direction };
    const refresh = () => setRevision((v) => v + 1);
    const copyGeneration = useRef(0);
    useEffect(() => { copyGeneration.current += 1; }, [detail, filters]);
    useEffect(() => () => { copyGeneration.current += 1; }, []);
    async function copy(row: Row) {
        const generation = ++copyGeneration.current;
        setError("");
        setNotice("");
        try {
            if (!row.subscribe_url) throw new Error("当前用户没有订阅链接");
            await navigator.clipboard.writeText(row.subscribe_url);
            if (generation !== copyGeneration.current) return;
            setNotice(`已复制 ${row.email} 的订阅链接`);
        } catch (e) {
            if (generation !== copyGeneration.current) return;
            setError((e as Error).message);
            setDetail({ kind: "link", row });
        }
    }
    return (
        <div className="users-page">
            {showDisplay && (
                <AdminDisplaySettings title="用户显示设置" columns={resources.users.columns} selected={optionalColumns}
                    onChange={setOptionalColumns} close={() => setShowDisplay(false)}
                    onReset={() => { setOptionalColumns(defaultUserColumns()); setPageSize(10); setSort("created_at"); setDirection("DESC"); }}>
                        <p className="muted">
                            上次连接为节点最近上报活动的时间，未上报显示为空，不代表当前在线。
                        </p>
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
                        </div>
                </AdminDisplaySettings>
            )}
            <ResourcePage
                key={JSON.stringify({ params, pageSize, revision })}
                resource={resources.users}
                hiddenColumns={resources.users.columns
                    .map(([key]) => key)
                    .filter((key) => !optionalColumns.includes(key))}
                queryParams={params}
                pageSize={pageSize}
                onPageSizeChange={setPageSize}
                searchable={false}
                onTotal={setTotal}
                tableSort={{
                    key: sort,
                    direction,
                    fields: userSortFields.map(([key]) => key),
                }}
                onTableSort={(key, next) => {
                    setSort(key);
                    setDirection(next);
                }}
                onUserDetails={(row) => setDetail({kind:"profile",row})}
                headerActions={<button type="button" onClick={() => setShowDisplay(true)}>显示设置</button>}
                toolbar={
                    <div className="pad user-toolbar">
                        <form
                            aria-label="用户搜索与筛选"
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
                        <div className="actions user-toolbar-actions">
                            <details className="admin-bulk-menu">
                                <summary>操作</summary>
                                <div className="admin-bulk-content">
                                    <AdminUsageReset
                                        filters={filters}
                                        count={total}
                                        onComplete={() => {
                                            refresh();
                                            setNotice("用量重置操作已完成");
                                        }}
                                    />
                                    <button
                                        disabled={!total}
                                        onClick={() =>
                                            setBulk({
                                                kind: "mail",
                                                filters:
                                                    structuredClone(filters),
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
                                                filters:
                                                    structuredClone(filters),
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
                                                filters:
                                                    structuredClone(filters),
                                                count: total,
                                            })
                                        }
                                    >
                                        批量删除
                                    </button>
                                </div>
                            </details>
                        </div>
                        <p className="muted">
                            {filters.length
                                ? `当前筛选结果 ${total} 名用户；批量操作使用全部匹配结果，不限当前页。`
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
                extraActions={(row, context, secondary) => (
                    <>
                        <button onClick={() => setDetail({kind:"assign",row})}>分配订单</button>
                        <AdminRowMenu context={context}>
                            <button onClick={() => setDetail({kind:"profile",row})}>用户详情</button>
                            <button onClick={() => copy(row)}>复制订阅链接</button>
                            <AdminUsageReset single filters={[{key:"id",condition:"=",value:row.id}]} count={1}
                                onComplete={() => {refresh();setNotice("储备重置次数已发放");}} />
                            {secondary}
                        </AdminRowMenu>
                    </>
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
            {detail?.kind === "profile" && <AdminUserDetails key={detail.row.id} row={detail.row} close={() => setDetail(null)} />}
            {detail && detail.kind !== "profile" && (
                <Modal
                    title={`${adminUserLabel({ user_id: detail.row.id, email: detail.row.email })} · ${{ assign: "分配订单", link: "订阅链接" }[detail.kind as "assign"] || ""}`}
                    guardChanges={detail.kind === "assign"}
                    close={() => setDetail(null)}
                >
                    {detail.kind === "assign" ? (
                        <AssignOrder
                            row={detail.row}
                            plans={plans.data || []}
                            loading={plans.loading}
                            error={plans.error}
                        />
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
function BulkUsers({
    operation,
    onComplete,
}: {
    operation: { kind: string; filters: UserFilter[]; count: number };
    onComplete: () => void;
}) {
    const mailRequestKey = useRef(crypto.randomUUID());
    const [confirmed, setConfirmed] = useState(false);
    const [purpose, setPurpose] = useState("service"),
        [audience, setAudience] = useState<Row | null>(null),
        [previewError, setPreviewError] = useState(""),
        [previewBusy, setPreviewBusy] = useState(false);
    useEffect(() => {
        setAudience(null);
        setConfirmed(false);
    }, [purpose]);
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
                      : "必要服务通知仅用于维护、故障及影响现有服务的调整；优惠与推广请选择活动与推广。所有用途都遵守退信和投诉停发规则。"}
            </p>
            {operation.kind === "mail" && (
                <div className="pad">
                    <label>
                        邮件用途
                        <select
                            disabled={previewBusy}
                            value={purpose}
                            onChange={(e) => setPurpose(e.target.value)}
                        >
                            <option value="service">必要服务通知</option>
                            <option value="marketing">
                                活动与推广（需用户订阅）
                            </option>
                        </select>
                    </label>
                    <button
                        type="button"
                        disabled={previewBusy}
                        onClick={async () => {
                            setPreviewBusy(true);
                            setPreviewError("");
                            setConfirmed(false);
                            try {
                                const r = await request(
                                    admin("user/previewMailAudience"),
                                    {
                                        purpose,
                                        filter: operation.filters,
                                        expected_count: operation.count,
                                    },
                                );
                                setAudience(r.data);
                            } catch (e) {
                                setPreviewError((e as Error).message);
                            } finally {
                                setPreviewBusy(false);
                            }
                        }}
                    >
                        检查收件范围
                    </button>
                    {previewError && <p role="alert">{previewError}</p>}
                    {audience && (
                        <p>
                            预计发送 {audience.eligible} 人；未订阅推广{" "}
                            {audience.not_subscribed} 人，人工禁发{" "}
                            {audience.manual_blocklist || 0} 人，退信或投诉停发{" "}
                            {audience.suppressed} 人，禁用{" "}
                            {audience.account_disabled}{" "}
                            人。实际发送前还会重新检查。记录可在「邮件日志 →
                            群发记录」查看。
                        </p>
                    )}
                </div>
            )}
            <label>
                <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                我已确认操作范围和人数
            </label>
            {operation.kind === "mail" ? (
                <AdminMailComposer
                    confirmed={confirmed && Boolean(audience)}
                    onSave={async (body) => {
                        await request(endpoint, {
                            ...body,
                            purpose,
                            request_key: mailRequestKey.current,
                            filter: operation.filters,
                            expected_count: operation.count,
                        });
                        onComplete();
                    }}
                />
            ) : (
                <Editor
                    fields={[]}
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
            )}
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
export function AssignOrder({
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
    const eligible = plans
        .map((p) =>
            row.currency === "USD"
                ? {
                      ...p,
                      ...Object.fromEntries(
                          periods.map(([key]) => [
                              key,
                              p.usd_prices?.[key] ?? null,
                          ]),
                      ),
                  }
                : p,
        )
        .filter((p) => periods.some(([key]) => p[key] != null));
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
                                label: `订单金额（${row.currency || "CNY"}）`,
                                type: "number",
                                min: 0,
                                step: 0.01,
                                scale: 100,
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
                                              (p?.[selected || ""] ?? 0) / 100,
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
