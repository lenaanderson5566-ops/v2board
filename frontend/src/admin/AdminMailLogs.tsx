import { AdminFilterBar } from "./AdminFilterBar";
import { AdminChoiceGroup } from "./AdminChoices";
import { Pager, FilterActions } from "../shared/ui";
import { AdminMailCampaigns } from "./AdminMailCampaigns";
import { MailHealth } from "./MailHealth";
import { useState } from "react";
import { admin, type Row } from "../shared/api";
import { Panel, Reload, State, useData } from "../shared/ui";
import {
    formatInstant,
    parseDateTimeInput,
    displayTimeZone,
} from "../shared/timezone";

const statuses: Record<string, string> = {
    skipped: "已跳过",
    sending: "发送中",
    accepted: "服务商已接受",
    failed: "发送失败",
    uncertain: "结果不确定",
    legacy: "历史记录",
};
const deliveries: Record<string, string> = {
    delivered: "已送达收件服务器",
    temporary: "暂时延迟",
    rejected: "投递被拒绝",
    bounced: "永久退信",
    complained: "用户投诉",
    unsubscribed: "已退订推广",
};
const types: Record<string, string> = {
    verify: "邮箱验证码",
    mailLogin: "邮件登录",
    remindTraffic: "流量提醒",
    remindExpire: "到期提醒",
    serviceActivated: "服务开通",
    serviceRenewed: "服务续费",
    notify: "通知邮件",
    emailInvitation: "注册邀请",
    ticketReply: "工单回复",
    test: "测试邮件",
};
const errors: Record<string, string> = {
    MAIL_MANUALLY_BLOCKED: "人工禁发名单拦截，未发送",
    MAIL_PROVIDER_INVALID: "发送通道配置无效",
    SES_CONFIG_INVALID: "检查 SES 区域、配置集和发件人",
    SES_KEY_INVALID: "AWS 凭据无效或不可用",
    SES_REQUEST_REJECTED: "检查 SES 身份验证、沙盒限制和 IAM 发送权限",
    SES_RATE_LIMITED: "SES 发送限额，队列将有限重试",
    SES_NETWORK_UNKNOWN: "SES 受理结果不确定，请核查 AWS 记录",
    SES_RESPONSE_UNKNOWN: "SES 响应异常，请核查 AWS 记录",
    RESEND_CONFIG_INVALID: "Resend 发件人配置无效",
    RESEND_KEY_INVALID: "Resend API Key 无效或无法解密",
    RESEND_AUTH_REJECTED: "检查 Resend 密钥及域名发送权限",
    RESEND_REQUEST_REJECTED: "Resend 拒绝请求，请检查域名验证和地址",
    RESEND_RATE_LIMITED: "Resend 发送限额，队列将有限重试",
    RESEND_IDEMPOTENCY_CONFLICT: "幂等请求冲突，请核查 Resend 记录",
    RESEND_NETWORK_UNKNOWN: "网络中断，请核查 Resend 记录",
    RESEND_SERVER_UNKNOWN: "Resend 服务异常，请核查记录",
    RESEND_RESPONSE_UNKNOWN: "Resend 响应异常，请核查记录",
    MAILGUN_CONFIG_INVALID: "Mailgun 配置无效",
    MAILGUN_KEY_INVALID: "API Key 未配置或无法解密",
    MAILGUN_NETWORK_UNKNOWN: "网络中断，需到 Mailgun 核查",
    MAILGUN_SERVER_UNKNOWN: "服务商异常，需到 Mailgun 核查",
    MAILGUN_RESPONSE_UNKNOWN: "服务商响应异常，需核查",
    MAILGUN_RATE_LIMITED: "触发发送限额，队列将有限重试",
    MAILGUN_AUTH_REJECTED: "认证或发送权限不足",
    MAILGUN_DOMAIN_NOT_FOUND: "检查域名和区域是否匹配",
    MAILGUN_REQUEST_REJECTED: "服务商拒绝请求，请检查发送域名和地址",
    MAILGUN_REQUEST_FAILED: "服务商拒绝请求",
    MAIL_RECIPIENT_INVALID: "收件地址无效",
    SMTP_KEY_INVALID: "SMTP 密码无法解密，请重新保存",
    SMTP_REJECTED: "SMTP 拒绝发送",
    SMTP_SEND_FAILED: "SMTP 发送失败",
};
const empty = {
    email: "",
    provider: "",
    status: "",
    template: "",
    from: "",
    to: "",
    transport_code: "",
    enhanced_code: "",
    stream: "",
    delivery_status: "",
};
export function AdminMailLogs() {
    const [pageSize, setPageSize] = useState(20);
    const [view, setView] = useState("logs");
    const [draft, setDraft] = useState(empty),
        [filters, setFilters] = useState<Record<string, string>>({}),
        [page, setPage] = useState(1),
        [error, setError] = useState("");
    const query = new URLSearchParams({
        ...filters,
        current: String(page),
        page_size: String(pageSize),
    });
    const logs = useData<Row[]>(
        view === "logs" ? admin(`mail-logs/fetch?${query}`) : "",
    );
    return (
        <Panel
            title="邮件发送日志"
            actions={
                view === "logs" ? (
                    <Reload onClick={logs.reload} loading={logs.loading} />
                ) : undefined
            }
        >
            <AdminChoiceGroup variant="navigation" label="邮件管理" value={view} onChange={setView}
                options={[{value:"logs",label:"投递日志"},{value:"campaigns",label:"群发记录"}]}>
                <a className="button" href="#/mail-blocklist">邮件禁发名单 ↗</a>
            </AdminChoiceGroup>
            {view === "campaigns" && <AdminMailCampaigns />}
            {view === "logs" && (
                <>
                    <MailHealth />
                    <p className="pad muted">
                        记录实际发送尝试；服务商接受不代表已送达收件箱。结果不确定时先核查服务商记录，避免重复发送。邮箱脱敏，正文、验证码及原始错误响应不展示。HTTP
                        200 仅表示 API 受理，SMTP 550
                        也不等于用户拉黑。配置签名回调后可查看最终退信和投诉；核实无效邮箱后暂停非必要邮件，不建议删除网站账号。
                    </p>
                    <AdminFilterBar
                        className="admin-log-filters"
                        onSubmit={(e) => {
                            e.preventDefault();
                            try {
                                const next: Record<string, string> = {};
                                for (const [key, value] of Object.entries(
                                    draft,
                                ))
                                    if (value.trim())
                                        next[key] =
                                            key === "from" || key === "to"
                                                ? String(
                                                      parseDateTimeInput(value),
                                                  )
                                                : value.trim();
                                if (
                                    next.from &&
                                    next.to &&
                                    Number(next.from) > Number(next.to)
                                )
                                    throw new Error("结束时间不能早于开始时间");
                                setFilters(next);
                                setPage(1);
                                setError("");
                            } catch (err) {
                                setError((err as Error).message);
                            }
                        }}
                    >
                        <label>
                            收件邮箱（精确查询）
                            <input
                                type="email"
                                value={draft.email}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        email: e.target.value,
                                    })
                                }
                                placeholder="输入完整邮箱"
                            />
                        </label>
                        <label>
                            发送通道
                            <select
                                value={draft.provider}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        provider: e.target.value,
                                    })
                                }
                            >
                                <option value="">全部</option>
                                <option value="smtp">SMTP</option>
                                <option value="mailgun">Mailgun API</option>
                                <option value="ses">Amazon SES</option>
                                <option value="resend">Resend</option>
                            </select>
                        </label>
                        <label>
                            邮件用途
                            <select
                                value={draft.stream}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        stream: e.target.value,
                                    })
                                }
                            >
                                <option value="">全部</option>
                                <option value="transactional">事务邮件</option>
                                <option value="announcement">活动与推广</option>
                            </select>
                        </label>
                        <label>
                            投递反馈
                            <select
                                value={draft.delivery_status}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        delivery_status: e.target.value,
                                    })
                                }
                            >
                                <option value="">全部</option>
                                {Object.entries(deliveries).map(
                                    ([key, label]) => (
                                        <option key={key} value={key}>
                                            {label}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        <label>
                            响应状态码
                            <input
                                type="number"
                                min="100"
                                max="599"
                                value={draft.transport_code}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        transport_code: e.target.value,
                                    })
                                }
                                placeholder="例如 429、550"
                            />
                        </label>
                        <label>
                            SMTP 增强码
                            <input
                                value={draft.enhanced_code}
                                pattern="[45]\.[0-9]{1,3}\.[0-9]{1,3}"
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        enhanced_code: e.target.value,
                                    })
                                }
                                placeholder="例如 5.1.1"
                            />
                        </label>
                        <label>
                            状态
                            <select
                                value={draft.status}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        status: e.target.value,
                                    })
                                }
                            >
                                <option value="">全部</option>
                                {Object.entries(statuses).map(
                                    ([value, label]) => (
                                        <option key={value} value={value}>
                                            {label}
                                        </option>
                                    ),
                                )}
                            </select>
                        </label>
                        <label>
                            邮件类型
                            <select
                                value={draft.template}
                                onChange={(e) =>
                                    setDraft({
                                        ...draft,
                                        template: e.target.value,
                                    })
                                }
                            >
                                <option value="">全部</option>
                                {Object.entries(types).map(([value, label]) => (
                                    <option key={value} value={value}>
                                        {label}
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label>
                            开始时间（{displayTimeZone()}）
                            <input
                                type="datetime-local"
                                value={draft.from}
                                onChange={(e) =>
                                    setDraft({ ...draft, from: e.target.value })
                                }
                            />
                        </label>
                        <label>
                            结束时间（{displayTimeZone()}）
                            <input
                                type="datetime-local"
                                value={draft.to}
                                onChange={(e) =>
                                    setDraft({ ...draft, to: e.target.value })
                                }
                            />
                        </label>
                        <FilterActions
                            loading={logs.loading}
                            onReset={() => {
                                setDraft(empty);
                                setFilters({});
                                setPage(1);
                                setError("");
                            }}
                        />
                    </AdminFilterBar>
                    {error && (
                        <p className="error" role="alert">
                            {error}
                        </p>
                    )}
                    <State {...logs} retry={logs.reload}>
                        <div className="table-wrap">
                            <table>
                                <thead>
                                    <tr>
                                        {[
                                            "时间",
                                            "收件邮箱",
                                            "类型 / 通道",
                                            "状态",
                                            "响应码",
                                            "诊断与建议",
                                            "服务商消息 ID",
                                            "耗时",
                                        ].map((label) => (
                                            <th key={label}>{label}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {(logs.data || []).map((row) => (
                                        <tr key={row.id}>
                                            <td>
                                                {formatInstant(row.created_at)}
                                            </td>
                                            <td>
                                                {row.email}
                                                {row.user_id && (
                                                    <>
                                                        <br />
                                                        <a
                                                            href={`#/users?user_id=${row.user_id}`}
                                                        >
                                                            查看用户 #
                                                            {row.user_id}
                                                        </a>
                                                    </>
                                                )}
                                            </td>
                                            <td>
                                                {types[row.template] || "其他"}
                                                <br />
                                                {row.stream === "announcement"
                                                    ? "推广"
                                                    : row.stream ===
                                                        "transactional"
                                                      ? "事务"
                                                      : "历史"}{" "}
                                                ·{" "}
                                                {row.provider === "legacy"
                                                    ? "历史通道"
                                                    : row.provider}
                                            </td>
                                            <td>
                                                {statuses[row.status] || "未知"}
                                                <br />
                                                <strong>
                                                    {deliveries[
                                                        row.delivery_status
                                                    ] || "暂无投递反馈"}
                                                </strong>
                                            </td>
                                            <td>
                                                {row.transport_code
                                                    ? `${row.provider === "smtp" ? "SMTP" : "HTTP"} ${row.transport_code}`
                                                    : "—"}
                                                {row.enhanced_code && (
                                                    <>
                                                        <br />
                                                        {row.enhanced_code}
                                                    </>
                                                )}
                                            </td>
                                            <td>
                                                {errors[row.error_code] ||
                                                    (row.status === "uncertain"
                                                        ? "请核查服务商记录"
                                                        : "—")}
                                                <p className="muted">
                                                    {row.advice ||
                                                        "暂无可靠投递结论"}
                                                </p>
                                            </td>
                                            <td>
                                                <span className="admin-ua-text">
                                                    {row.message_id || "—"}
                                                </span>
                                            </td>
                                            <td>
                                                {row.duration_ms == null
                                                    ? "—"
                                                    : `${row.duration_ms} ms`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                            {!logs.data?.length && (
                                <p className="pad">暂无匹配邮件日志</p>
                            )}
                        </div>
                    </State>
                    <Pager
                        size={pageSize}
                        onSizeChange={(size) => {
                            setPageSize(size);
                            setPage(1);
                        }}
                        page={page}
                        total={logs.total}
                        loading={logs.loading}
                        onChange={setPage}
                    />
                </>
            )}
        </Panel>
    );
}
