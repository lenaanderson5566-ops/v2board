import { field } from "./admin-fields";
import { useRef, useState } from "react";
import { admin, request, type Row } from "../shared/api";
import {
    Editor,
    Html,
    Modal,
    Panel,
    State,
    Table,
    useData,
} from "../shared/ui";
import {
    PaymentCategoryEditor,
    paymentCategoryInitial,
} from "./PaymentCategoryEditor";
import { sortPayload } from "./admin-actions";
import { AdminSwitch } from "./admin-switch";
import { SortButton } from "./admin-tools";
import {
    paymentFields,
    paymentInitial,
    paymentPayload,
} from "./payment-fields";
import {
    paymentIconInitial,
    paymentIcons,
    resolvePaymentIcon,
} from "./payment-icons";
export function Payments() {
    const d = useData<Row[]>(admin("payment/fetch")),
        methods = useData<string[]>(admin("payment/getPaymentMethods"));
    const [editing, setEditing] = useState<Row | null>(null);
    const pending = useRef(false);
    const [deleting, setDeleting] = useState(false);
    const [error, setError] = useState("");
    return (
        <>
            <Panel
                title="支付渠道"
                actions={
                    <>
                        {" "}
                        <SortButton
                            path={admin("payment/sort")}
                            kind="payments"
                            items={d.data || []}
                            onSaved={d.reload}
                        />
                        <button
                            className="primary"
                            disabled={
                                methods.loading ||
                                Boolean(methods.error) ||
                                !methods.data?.length
                            }
                            onClick={() => setEditing({})}
                        >
                            添加支付方式
                        </button>
                    </>
                }
            >
                {error && <div className="alert" role="alert">{error}</div>}
                {deleting && <div className="admin-refresh-note" role="status" data-saving="true">正在删除支付方式…</div>}
                <State
                    loading={d.loading || methods.loading}
                    error={d.error || methods.error}
                    retry={() => {
                        d.reload();
                        methods.reload();
                    }}
                >
                    <Table
                        data={d.data || []}
                        columns={[
                            ["id", "ID"],
                            [
                                "enable",
                                "启用",
                                (r) => (
                                    <AdminSwitch
                                        label={`${r.name} 启用`}
                                        checked={Number(r.enable) === 1}
                                        onChange={async () => {
                                            await request(
                                                admin("payment/show"),
                                                {
                                                    id: r.id,
                                                },
                                            );
                                            d.reload();
                                        }}
                                    />
                                ),
                            ],
                            ["name", "显示名称"],
                            ["payment", "支付接口"],
                            ["notify_url", "通知地址"],
                        ]}
                        onReorder={async (items) => {
                            await request(
                                admin("payment/sort"),
                                sortPayload("payments", items),
                            );
                            d.reload();
                        }}
                        actions={(r) => (
                            <>
                                <button onClick={() => setEditing(r)}>
                                    编辑
                                </button>
                                <button
                                    className="danger"
                                    disabled={deleting || d.loading}
                                    onClick={async () => {
                                        if (pending.current || !confirm(`确认删除支付方式「${r.name}」？`)) return;
                                        pending.current = true;
                                        setDeleting(true);
                                        setError("");
                                        try {
                                            await request(admin("payment/drop"), { id: r.id });
                                            d.reload();
                                        } catch (e) {
                                            setError((e as Error).message);
                                        } finally {
                                            pending.current = false;
                                            setDeleting(false);
                                        }
                                    }}
                                >
                                    删除
                                </button>
                            </>
                        )}
                    />
                </State>
            </Panel>
            {editing && (
                <Modal
                    variant="modal"
                    title="支付方式设置"
                    close={() => setEditing(null)}
                >
                    <PaymentEditor
                        initial={editing}
                        methods={methods.data || []}
                        onSave={async (b) => {
                            await request(admin("payment/save"), b);
                            setEditing(null);
                            d.reload();
                        }}
                    />
                </Modal>
            )}
        </>
    );
}
function PaymentEditor({
    initial,
    methods,
    onSave,
}: {
    initial: Row;
    methods: string[];
    onSave: (b: Row) => Promise<void>;
}) {
    const [method, setMethod] = useState(initial.payment || methods[0] || "");
    const [commonDraft, setCommonDraft] = useState<Row>(() =>
        paymentIconInitial(initial),
    );
    const [iconPreset, setIconPreset] = useState(
        () => paymentIconInitial(initial).iconPreset,
    );
    const [category, setCategory] = useState(() =>
        paymentCategoryInitial(initial.config),
    );
    const d = useData(method ? admin("payment/getPaymentForm") : "", {
        payment: method,
        id: method === initial.payment ? initial.id : undefined,
    });
    return (
        <>
            <div className="pad">
                <label>
                    支付网关
                    <select
                        value={method}
                        onChange={(e) => setMethod(e.target.value)}
                    >
                        {methods.map((m) => (
                            <option key={m}>{m}</option>
                        ))}
                    </select>
                </label>
            </div>
            <PaymentCategoryEditor value={category} onChange={setCategory} />
            {category.category === "regular" && (
                <div className="pad payment-icon-settings">
                    <span>支付图标</span>
                    <div
                        className="payment-icon-options"
                        role="group"
                        aria-label="选择支付图标"
                    >
                        {paymentIcons.map((item) => (
                            <button
                                type="button"
                                key={item.id}
                                aria-pressed={iconPreset === item.id}
                                onClick={() => setIconPreset(item.id)}
                            >
                                <img src={item.source} alt="" />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                    <div className="payment-icon-preview">
                        <span>当前图标</span>
                        <img
                            key={resolvePaymentIcon(
                                commonDraft.icon,
                                iconPreset,
                            )}
                            src={
                                commonDraft.icon?.trim() ||
                                paymentIcons.find(
                                    (item) => item.id === iconPreset,
                                )?.source
                            }
                            alt="支付图标预览"
                            onError={(event) => {
                                event.currentTarget.hidden = true;
                            }}
                        />
                        <span className="muted">
                            填写图标链接后优先使用链接图片，清空后使用所选图标。
                        </span>
                    </div>
                </div>
            )}
            <State {...d} retry={d.reload}>
                {Object.entries(d.data || {})
                    .filter(([, v]) => v.type === "alert")
                    .map(([key, v]) => (
                        <div className="pad muted" key={key}>
                            <Html value={v.content} />
                        </div>
                    ))}
                <Editor
                    key={method}
                    fields={[
                        field("name", "显示名称", "text", true),
                        {
                            ...field("icon", "支付图标链接", "url"),
                            hint:
                                category.category === "crypto"
                                    ? "可选，填写后覆盖币种图标"
                                    : "可选，填写后覆盖上方所选图标",
                        },
                        {
                            key: "currency",
                            label: "付款币种（美元仅支持 StripeCheckout）",
                            type: "select",
                            options: [
                                ["CNY", "人民币 CNY"],
                                ["USD", "美元 USD"],
                            ],
                        },
                        field("notify_domain", "通知域名", "url"),
                        {
                            ...field(
                                "handling_fee_fixed",
                                "固定手续费（支付币种）",
                                "number",
                            ),
                            min: 0,
                            step: 0.01,
                            scale: 100,
                        },
                        {
                            ...field(
                                "handling_fee_percent",
                                "手续费比例 (%)",
                                "number",
                            ),
                            min: 0,
                            max: 100,
                        },
                        ...paymentFields(d.data || {}),
                    ]}
                    initial={paymentInitial(
                        { ...initial, ...commonDraft },
                        d.data || {},
                        method === initial.payment,
                    )}
                    onValuesChange={(values) =>
                        setCommonDraft(
                            Object.fromEntries(
                                [
                                    "name",
                                    "icon",
                                    "notify_domain",
                                    "currency",
                                    "handling_fee_fixed",
                                    "handling_fee_percent",
                                ].map((key) => [
                                    key,
                                    key === "handling_fee_fixed" &&
                                    values[key] != null
                                        ? Math.round(Number(values[key]) * 100)
                                        : values[key],
                                ]),
                            ),
                        )
                    }
                    onSave={async (b) => {
                        await onSave(
                            paymentPayload(
                                {
                                    ...b,
                                    iconPreset,
                                    checkoutCategory: category,
                                },
                                d.data || {},
                                method,
                                initial,
                            ),
                        );
                    }}
                />
            </State>
        </>
    );
}
