import { useState } from "react";
import { admin, request } from "../shared/api";
import { languages } from "../shared/i18n";
import { State, useData, Pager } from "../shared/ui";
import { useAdminOperation } from "./admin-operation";
import { AdminOperationNotice } from "./admin-section";
type Variant = {
    name?: string;
    activityTitle?: string;
    activityDescription?: string;
};
type CouponPresentation = {
    id: number;
    name: string;
    public_claim: number;
    activity_title: string | null;
    activity_description: string | null;
    translations: Record<string, Variant> | null;
};

export function AdminCouponPresentation() {
    const [pageSize, setPageSize] = useState(20);
    const [search, setSearch] = useState(""),
        [query, setQuery] = useState(""),
        [page, setPage] = useState(1);
    const data = useData<CouponPresentation[]>(
        admin(
            `coupon-presentation/fetch?current=${page}&pageSize=${pageSize}&search=${encodeURIComponent(query)}`,
        ),
    );
    const [selected, setSelected] = useState<CouponPresentation | null>(null),
        [title, setTitle] = useState(""),
        [description, setDescription] = useState("");
    const [language, setLanguage] = useState("en-US"),
        [translations, setTranslations] = useState<Record<string, Variant>>({});
    const operation = useAdminOperation();
    const variant = translations[language] || {};
    return (
        <section className="panel">
            <div className="panel-head">
                <h2>活动与优惠券多语言</h2>
            </div>
            <p className="pad muted">
                默认券名称在券模板中维护。启用公开领取后显示在用户活动中心；未填写的译文回退到默认文案。说明使用纯文本，优惠、库存和使用范围始终由券模板统一控制。
            </p>
            <form
                className="actions pad"
                onSubmit={(event) => {
                    event.preventDefault();
                    setQuery(search.trim());
                    setPage(1);
                }}
            >
                <label>
                    搜索券名称或 ID
                    <input
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                    />
                </label>
                <button disabled={operation.busy}>搜索</button>
            </form>
            <State {...data} retry={data.reload}>
                <div className="pad admin-commerce-form">
                    <label>
                        选择优惠券
                        <select
                            value={selected?.id || ""}
                            disabled={operation.busy}
                            onChange={(event) => {
                                const coupon =
                                    data.data?.find(
                                        (row) =>
                                            row.id ===
                                            Number(event.target.value),
                                    ) || null;
                                setSelected(coupon);
                                setTitle(coupon?.activity_title || "");
                                setDescription(
                                    coupon?.activity_description || "",
                                );
                                setTranslations(coupon?.translations || {});
                                operation.clear();
                            }}
                        >
                            <option value="">请选择优惠券</option>
                            {data.data?.map((coupon) => (
                                <option key={coupon.id} value={coupon.id}>
                                    #{coupon.id} · {coupon.name}
                                </option>
                            ))}
                        </select>
                    </label>
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
            </State>
            {selected && (
                <form
                    className="pad admin-commerce-form"
                    onSubmit={(event) => {
                        event.preventDefault();
                        void operation.run(async () => {
                            await request(admin("coupon-presentation/save"), {
                                id: selected.id,
                                activity_title: title.trim() || null,
                                activity_description:
                                    description.trim() || null,
                                translations,
                            });
                            data.reload();
                            return "活动文案及翻译已保存，已发出的券保持原快照。";
                        });
                    }}
                >
                    <AdminOperationNotice notice={operation.notice} />
                    <fieldset disabled={operation.busy}>
                        <p>
                            默认券名称：{selected.name} ·{" "}
                            {selected.public_claim
                                ? "已开放活动领取"
                                : "未开放活动领取"}
                        </p>
                        <label>
                            默认活动标题
                            <input
                                maxLength={120}
                                value={title}
                                onChange={(event) =>
                                    setTitle(event.target.value)
                                }
                                placeholder="留空使用券名称"
                            />
                        </label>
                        <label>
                            默认活动说明
                            <textarea
                                maxLength={2000}
                                rows={4}
                                value={description}
                                onChange={(event) =>
                                    setDescription(event.target.value)
                                }
                            />
                        </label>
                        <label>
                            翻译语言
                            <select
                                value={language}
                                onChange={(event) =>
                                    setLanguage(event.target.value)
                                }
                            >
                                {languages.map((locale) => (
                                    <option
                                        key={locale.code}
                                        value={locale.code}
                                    >
                                        {locale.name}
                                    </option>
                                ))}
                            </select>
                        </label>
                        {(
                            [
                                "name",
                                "activityTitle",
                                "activityDescription",
                            ] as const
                        ).map((key) => (
                            <label key={key}>
                                {
                                    {
                                        name: "翻译券名称",
                                        activityTitle: "翻译活动标题",
                                        activityDescription: "翻译活动说明",
                                    }[key]
                                }
                                {key === "activityDescription" ? (
                                    <textarea
                                        rows={4}
                                        maxLength={2000}
                                        value={variant[key] || ""}
                                        onChange={(event) =>
                                            setTranslations((previous) => ({
                                                ...previous,
                                                [language]: {
                                                    ...previous[language],
                                                    [key]: event.target.value,
                                                },
                                            }))
                                        }
                                    />
                                ) : (
                                    <input
                                        maxLength={key === "name" ? 100 : 120}
                                        value={variant[key] || ""}
                                        onChange={(event) =>
                                            setTranslations((previous) => ({
                                                ...previous,
                                                [language]: {
                                                    ...previous[language],
                                                    [key]: event.target.value,
                                                },
                                            }))
                                        }
                                    />
                                )}
                            </label>
                        ))}
                    </fieldset>
                    <div className="actions">
                        <button
                            type="button"
                            disabled={operation.busy}
                            onClick={() =>
                                setTranslations((previous) => {
                                    const next = { ...previous };
                                    delete next[language];
                                    return next;
                                })
                            }
                        >
                            清空当前语言翻译
                        </button>
                        <button className="primary" disabled={operation.busy}>
                            保存活动与翻译
                        </button>
                    </div>
                </form>
            )}
        </section>
    );
}
