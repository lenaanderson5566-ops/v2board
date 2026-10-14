import { useState, type FormEvent } from "react";
import { Send, ListFilter, Users, Eye } from "lucide-react";
import { admin, request, type Row } from "../shared/api";
import { State, useData, Modal } from "../shared/ui";
import { useAdminOperation } from "./admin-operation";
import { AdminOperationNotice } from "./admin-section";
import { UserFilters } from "./UserFilters";
import { userFilterFields, type UserFilter } from "./user-filters";
import type { CouponCampaign } from "./coupon-campaign";

type CouponTemplate = {
    id: number;
    name: string;
    type: number;
    value: number;
    show: number;
};
export function AdminCouponIssue({ onQueued }: { onQueued: () => void }) {
    const coupons = useData<CouponTemplate[]>(
        admin("coupon/fetch?pageSize=100"),
    );
    const plans = useData<Row[]>(admin("plan/fetch"));
    const templates =
        coupons.data?.filter((item) => item.type === 2 && item.show) ?? [];
    const [coupon, setCoupon] = useState(""),
        [scope, setScope] = useState<"filtered" | "all" | "ids">("filtered");
    const [users, setUsers] = useState(""),
        [filters, setFilters] = useState<UserFilter[]>([]),
        [showFilters, setShowFilters] = useState(false);
    const [preview, setPreview] = useState<CouponCampaign | null>(null),
        [confirmed, setConfirmed] = useState(false);
    const operation = useAdminOperation();
    function check(event: FormEvent) {
        event.preventDefault();
        void operation.run(async () => {
            if (preview) return "请确认预览或先修改范围。";
            if (!templates.some((item) => String(item.id) === coupon))
                throw new Error("请选择有效的百分比券。");
            let ids: number[] | undefined;
            if (scope === "ids") {
                ids = [
                    ...new Set(
                        users
                            .trim()
                            .split(/[\s,，]+/)
                            .map(Number),
                    ),
                ];
                if (
                    !ids.length ||
                    ids.length > 100 ||
                    ids.some((id) => !Number.isSafeInteger(id) || id < 1)
                )
                    throw new Error("请输入 1–100 个有效用户 ID。");
            }
            if (scope === "filtered" && !filters.length)
                throw new Error("请添加筛选条件，或明确选择全员发放。");
            const result = await request<CouponCampaign>(
                admin("coupon-campaign/preview"),
                {
                    coupon_id: Number(coupon),
                    scope,
                    filter: scope === "filtered" ? filters : [],
                    ...(ids ? { user_ids: ids } : {}),
                },
            );
            setPreview(result.data);
            setConfirmed(false);
            return "已固定本次用户名单，请核对人数与库存。";
        });
    }
    const insufficient =
        preview?.stock !== null &&
        preview != null &&
        preview.stock < preview.pending;
    return (
        <section className="panel">
            <div className="panel-head">
                <h2>发放到用户券包</h2>
            </div>
            <State {...coupons} retry={coupons.reload}>
                <form
                    className="pad admin-commerce-form admin-coupon-issue"
                    onSubmit={check}
                >
                    <AdminOperationNotice notice={operation.notice} />
                    <fieldset
                        disabled={
                            operation.busy ||
                            !!preview ||
                            coupons.loading ||
                            !!coupons.error
                        }
                    >
                        <label>
                            优惠券
                            <select
                                required
                                value={coupon}
                                onChange={(event) =>
                                    setCoupon(event.target.value)
                                }
                            >
                                <option value="">选择百分比券</option>
                                {templates.map((item) => (
                                    <option key={item.id} value={item.id}>
                                        {item.name} · 减 {item.value}%
                                    </option>
                                ))}
                            </select>
                        </label>
                        {!templates.length && (
                            <p className="muted">
                                暂无可发放的百分比券，请先创建并启用券模板。
                            </p>
                        )}
                        <label>
                            发放范围
                            <select
                                value={scope}
                                onChange={(event) =>
                                    setScope(event.target.value as typeof scope)
                                }
                            >
                                <option value="filtered">
                                    按用户管理条件筛选
                                </option>
                                <option value="all">全员发放</option>
                                <option value="ids">指定用户 ID</option>
                            </select>
                        </label>
                        {scope === "filtered" && (
                            <>
                                <div className="actions">
                                    <button
                                        type="button"
                                        disabled={
                                            plans.loading || !!plans.error
                                        }
                                        onClick={() => setShowFilters(true)}
                                    >
                                        <ListFilter size={16} />
                                        设置用户筛选
                                        {filters.length
                                            ? `（${filters.length}）`
                                            : ""}
                                    </button>
                                </div>
                                <div className="admin-coupon-filter-summary">
                                    {filters.length ? (
                                        filters.map((filter, i) => (
                                            <span
                                                className="filter-chip"
                                                key={i}
                                            >
                                                {
                                                    userFilterFields.find(
                                                        ([key]) =>
                                                            key === filter.key,
                                                    )?.[1]
                                                }{" "}
                                                {filter.condition}{" "}
                                                {[
                                                    "token",
                                                    "uuid",
                                                    "email",
                                                    "invite_by_email",
                                                ].includes(filter.key)
                                                    ? "已设置"
                                                    : String(filter.value)}
                                            </span>
                                        ))
                                    ) : (
                                        <p className="muted">
                                            未设置筛选条件。
                                        </p>
                                    )}
                                </div>
                                {plans.error && (
                                    <p role="alert">{plans.error}</p>
                                )}
                            </>
                        )}
                        {scope === "all" && (
                            <p className="muted">
                                <Users size={16} aria-hidden="true" />
                                匹配当前全部用户；禁用账户和已领取用户会跳过。
                            </p>
                        )}
                        {scope === "ids" && (
                            <label>
                                用户 ID
                                <textarea
                                    required
                                    rows={4}
                                    value={users}
                                    onChange={(event) =>
                                        setUsers(event.target.value)
                                    }
                                    placeholder="例如：12, 35, 86"
                                />
                            </label>
                        )}
                        <p className="muted">
                            先预览，再确认发放。名单在预览时固定，有效期 10
                            分钟；确认时预留库存，后台每分钟分批处理。
                        </p>
                    </fieldset>
                    {!preview && (
                        <div className="actions">
                            <button
                                className="primary"
                                disabled={
                                    operation.busy ||
                                    coupons.loading ||
                                    !!coupons.error ||
                                    !templates.length
                                }
                            >
                                <Eye size={16} />
                                {operation.busy ? "正在预览…" : "预览发放范围"}
                            </button>
                        </div>
                    )}
                    {preview && (
                        <div className="admin-coupon-preview">
                            <h3>发放预览 · {preview.couponName}</h3>
                            <p>
                                匹配 {preview.matched} 人 · 待发放{" "}
                                {preview.pending} 人 · 已领取或禁用跳过{" "}
                                {preview.skipped} 人
                            </p>
                            <p>
                                可用库存：
                                {preview.stock === null
                                    ? "不限"
                                    : preview.stock}
                                ；本次需预留 {preview.pending} 张。
                            </p>
                            {insufficient && (
                                <p role="alert">
                                    库存不足，请补充库存后重新预览，或调整发放范围。
                                </p>
                            )}
                            <label className="admin-coupon-confirm">
                                <input
                                    type="checkbox"
                                    checked={confirmed}
                                    disabled={operation.busy}
                                    onChange={(event) =>
                                        setConfirmed(event.target.checked)
                                    }
                                />
                                我已核对发放范围及人数
                            </label>
                            <div className="actions">
                                <button
                                    type="button"
                                    className="primary"
                                    disabled={
                                        operation.busy ||
                                        !confirmed ||
                                        insufficient ||
                                        !preview.pending
                                    }
                                    onClick={() =>
                                        void operation.run(async () => {
                                            await request(
                                                admin(
                                                    "coupon-campaign/confirm",
                                                ),
                                                {
                                                    preview_key:
                                                        preview.previewKey,
                                                    confirmed: true,
                                                },
                                            );
                                            setPreview(null);
                                            onQueued();
                                            return "已创建发放批次。";
                                        })
                                    }
                                >
                                    <Send size={16} />
                                    确认分批发放
                                </button>
                                <button
                                    type="button"
                                    disabled={operation.busy}
                                    onClick={() =>
                                        void operation.run(async () => {
                                            await request(
                                                admin("coupon-campaign/cancel"),
                                                { id: preview.id },
                                            );
                                            setPreview(null);
                                            setConfirmed(false);
                                            return "可重新设置发放范围。";
                                        })
                                    }
                                >
                                    修改范围
                                </button>
                            </div>
                        </div>
                    )}
                </form>
            </State>
            {showFilters && (
                <Modal title="发券用户筛选" close={() => setShowFilters(false)}>
                    <UserFilters
                        initial={filters}
                        plans={plans.data || []}
                        onApply={(value) => {
                            setFilters(value);
                            setShowFilters(false);
                            operation.clear();
                        }}
                    />
                </Modal>
            )}
        </section>
    );
}
