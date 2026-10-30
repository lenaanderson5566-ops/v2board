import { AdminBrowserPreview } from "./AdminBrowserPreview";
import "./admin-management.css";
import { useId, useRef, useState } from "react";
import { admin, request, rows, type Row } from "../shared/api";
import { tx } from "../shared/i18n";
import { formatInstant, utcOffsetLabel, validZone } from "../shared/timezone";
import "./admin-timezone-impact.css";
import { supportedClients as recommendationClients } from "../shared/import-links";
import { Editor, Panel, State, useData } from "../shared/ui";
import type { Device as RecommendationDevice } from "../shared/user-experience";
import { AdminEntrypoints } from "./AdminEntrypoints";
import { AdminFastaiDownloads } from "./AdminFastaiDownloads";
import { AdminMailPreview } from "./AdminMailPreview";
import { AdminTelegramCommunity } from "./AdminTelegramCommunity";
import { configField } from "./admin-fields";
import { adminPlanOptions } from "./admin-plan-reference";
import {
    changedSettings,
    linkSettings,
    settingsFields,
    validateSettings,
} from "./admin-linkage";
import {
    adminLabels as labels,
    settingsPresentation,
} from "./admin-presentation";
import { mailCredentialField, mailProviders } from "./mail-settings";
const groupNames: Record<string, string> = {
    site: "站点设置",
    footer: "页脚 HTML",
    safe: "安全与注册",
    browser: "浏览器访问",
    subscribe: "订阅设置",
    server: "节点通讯",
    invite: "邀请与佣金",
    email: "邮件发送",
    telegram: "Telegram",
    ticket: "工单设置",
    deposit: "充值奖励",
    app: "专用客户端下载",
    entrypoints: "服务入口",
};
const settingsCategories = [
    { label: "站点与体验", keys: ["site", "footer", "browser"] },
    {
        label: "账户与业务",
        keys: ["safe", "subscribe", "invite", "deposit", "ticket"],
    },
    {
        label: "通知与接入",
        keys: ["email", "telegram", "server", "entrypoints"],
    },
];
const groupDescriptions: Record<string, string> = {
    site: "站点信息、展示与默认偏好",
    footer: "页脚内容与自定义 HTML",
    browser: "内置浏览器访问规则与引导预览",
    safe: "注册、登录与账户保护",
    subscribe: "订阅交付、试用与额度权限",
    invite: "邀请奖励和佣金规则",
    deposit: "账户充值与奖励规则",
    ticket: "工单提交与服务支持",
    email: "发送通道、投递回调与测试",
    telegram: "机器人通知与用户群",
    server: "节点 API 与通讯设置",
    entrypoints: "服务地址与入口配置",
    app: "客户端分发与下载账号",
};
export function Settings({ section }: { section?: string } = {}) {
    const d = useData(admin("config/fetch"));
    const schema = useData(admin("console/configSchema"));
    const [group, setGroup] = useState(section || "site"),
        [saved, setSaved] = useState("");
    const plans = useData<Row[]>(group === "site" ? admin("plan/fetch") : "");
    const creditGroups = useData<Row[]>(group === "subscribe" ? admin("server/group/fetch") : "");
    const [categorySearch, setCategorySearch] = useState("");
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false),
        [actionBusy, setActionBusy] = useState(false),
        [actionResult, setActionResult] = useState("");
    const actionPending = useRef(false);
    async function runAction(
        endpoint: string,
        body: Record<string, unknown> = {},
    ) {
        if (actionPending.current) return;
        actionPending.current = true;
        setActionBusy(true);
        setActionResult("");
        try {
            const response = await request(admin(endpoint), body);
            const log = (
                response as typeof response & {
                    log?: {
                        error?: string;
                        transport_code?: number;
                        enhanced_code?: string;
                        advice?: string;
                    };
                }
            ).log;
            if (log?.error)
                throw new Error(
                    [
                        log.error,
                        log.transport_code
                            ? `状态码 ${log.transport_code}`
                            : "",
                        log.enhanced_code,
                        log.advice,
                    ]
                        .filter(Boolean)
                        .join(" · "),
                );
            setActionResult(
                endpoint === "config/testSendMail"
                    ? "邮件已被发送服务接受，请检查收件箱；最终投递结果需核查服务商记录。"
                    : "操作成功",
            );
        } catch (e) {
            setActionResult((e as Error).message);
        } finally {
            actionPending.current = false;
            setActionBusy(false);
        }
    }
    const [previewValues, setPreviewValues] = useState<Row | null>(null);
    const [confirmedTimezone, setConfirmedTimezone] = useState("");
    const timezoneInput = useRef<string | undefined>(undefined);
    const timezoneReviewId = useId();
    const latestSource = d.data?.[group === "browser" ? "safe" : group];
    const editSource = useRef<{ group: string; value: Row } | undefined>(undefined);
    // A background refresh must not replace the baseline of an unsaved form.
    // Saving still sends only fields changed from this editing snapshot.
    if (editSource.current?.group !== group || (!dirty && !saving && !d.loading && !d.error))
        editSource.current = { group, value: latestSource || {} };
    const source = editSource.current?.value || {};
    const loadedGroup = useRef<string | undefined>(undefined);
    if (d.data && schema.data && (group !== "site" || plans.data) && (group !== "subscribe" || creditGroups.data))
        loadedGroup.current = group;
    const raw: Row = Object.fromEntries(
        Object.entries(source).filter(([key]) =>
            group === "browser"
                ? key.startsWith("browser_policy_")
                : group !== "safe" || !key.startsWith("browser_policy_"),
        ),
    );
    const fields = settingsPresentation(
        group === "browser" ? "safe" : group,
        Object.entries(raw)
            .filter(
                ([k]) =>
                    !k.startsWith("frontend_") &&
                    !k.startsWith("client_primary_") &&
                    !k.startsWith("client_secondary_") &&
                    !k.startsWith("subscription_") &&
                    k !== "email_template" &&
                    !/^email_.*_key_configured$/.test(k) &&
                    k !== "invite_never_expire" &&
                    k !== "fastai_releases" &&
                    k !== "fastai_enabled" &&
                    !k.startsWith("fastai_entrypoint"),
            )
            .map(([k, v]) =>
                k === "landing_style"
                    ? {
                          key: k,
                          label: "落地页样式",
                          hint: "极简落地页向下滚动后进入登录界面。",
                          type: "select" as const,
                          options: [
                              ["original", "原版落地页"],
                              ["minimal", "极简落地页"],
                          ] as [string, string][],
                      }
                    : k === "credit_base_group_id"
                      ? {
                            key: k,
                            label: "额度基础权限组",
                            type: "select" as const,
                            options: [
                                ["", "未配置（沿用原权限）"] as [
                                    string,
                                    string,
                                ],
                                ...rows(creditGroups.data).map(
                                    (r) =>
                                        [String(r.id), r.name] as [
                                            string,
                                            string,
                                        ],
                                ),
                            ],
                        }
                      : k === "try_out_plan_id"
                        ? {
                              key: k,
                              label: "试用套餐",
                              type: "select" as const,
                              options: [
                                  ["0", "不指定套餐"] as [string, string],
                                  ...adminPlanOptions(rows(plans.data), v, plans),
                              ],
                          }
                        : /^client_(primary|secondary)_/.test(k)
                          ? {
                                key: k,
                                label: labels[k],
                                type: "select" as const,
                                options: [
                                    ["", "使用默认推荐"] as [string, string],
                                    ...recommendationClients(
                                        k
                                            .split("_")
                                            .pop() as RecommendationDevice,
                                    ).map(
                                        (c) =>
                                            [c.id, c.name] as [string, string],
                                    ),
                                ],
                            }
                          : configField(k, v, schema.data?.[k], labels[k] || k),
            ),
    ).map((field) => mailCredentialField(field, raw));
    const savedTimezone = String(latestSource?.system_timezone || raw.system_timezone || "");
    const hasTimezoneField = fields.some(field => field.key === "system_timezone");
    const timezoneChangeKey = (value: unknown) => `${group}:${savedTimezone}:${String(value || "")}`;
    function timezoneReview(values: Row) {
        const nextTimezone = String(values.system_timezone || "");
        if (!hasTimezoneField || !validZone(savedTimezone) || !validZone(nextTimezone) || savedTimezone === nextTimezone) return null;
        const at = new Date();
        const instantInZone = (zone: string) => `${formatInstant(at, { timeZoneName: undefined }, zone)} ${utcOffsetLabel(at, zone)}`;
        return <section className="admin-timezone-impact" aria-labelledby={timezoneReviewId} role="note">
            <h4 id={timezoneReviewId}>{tx("timeZoneChangeTitle", { ns: "experience", defaultValue: "Review business time zone change" })}</h4>
            <p>{tx("timeZoneChangeImpact", { ns: "experience", defaultValue: "Changing the business time zone changes traffic-reset dates, reporting day boundaries and daily-task times. Saved timestamps and personal display preferences stay the same." })}</p>
            <dl>
                <div><dt>{tx("timeZoneChangeCurrent", { ns: "experience", zone: savedTimezone, defaultValue: "Current: {{zone}}" })}</dt><dd><time dateTime={at.toISOString()}>{instantInZone(savedTimezone)}</time></dd></div>
                <div><dt>{tx("timeZoneChangeNew", { ns: "experience", zone: nextTimezone, defaultValue: "New: {{zone}}" })}</dt><dd><time dateTime={at.toISOString()}>{instantInZone(nextTimezone)}</time></dd></div>
            </dl>
            <label className="admin-timezone-confirm">
                <input type="checkbox" required checked={confirmedTimezone === timezoneChangeKey(nextTimezone)} disabled={saving || d.loading || Boolean(d.error)}
                    onChange={event => {
                        timezoneInput.current = nextTimezone;
                        setConfirmedTimezone(event.target.checked ? timezoneChangeKey(nextTimezone) : "");
                    }} />
                <span>{tx("timeZoneChangeConfirm", { ns: "experience", from: savedTimezone, to: nextTimezone, defaultValue: "I have reviewed the impact and confirm changing the business time zone from {{from}} to {{to}}." })}</span>
            </label>
        </section>;
    }
    return (
        <Panel
            title={section ? ({site:"基础信息",browser:"浏览器引导",safe:"账户与注册"} as Record<string,string>)[section] || groupNames[section] : "系统配置"}
            className="settings-panel"
        >
            <div
                data-saving={saving || actionBusy ? "true" : undefined}
                className={section ? "" : "admin-settings-layout"}
            >
                {!section && (
                    <nav
                        className="admin-settings-nav"
                        aria-label="系统设置分类"
                    >
                        <label className="admin-settings-search">
                            搜索设置分类
                            <input
                                type="search"
                                value={categorySearch}
                                placeholder="站点、邮件、节点…"
                                onChange={(e) =>
                                    setCategorySearch(e.target.value)
                                }
                            />
                        </label>
                        {settingsCategories.map((category) => {
                            const keys = category.keys.filter((key) =>
                                (groupNames[key] + groupDescriptions[key])
                                    .toLowerCase()
                                    .includes(
                                        categorySearch.trim().toLowerCase(),
                                    ),
                            );
                            return keys.length ? (
                                <section key={category.label}>
                                    <h3>{category.label}</h3>
                                    {keys.map((key) => (
                                        <button
                                            type="button"
                                            key={key}
                                            aria-pressed={key === group}
                                            disabled={saving || actionBusy}
                                            onClick={() => {
                                                if (key === group) return;
                                                if (
                                                    dirty &&
                                                    !window.confirm(
                                                        "当前分类有未保存的修改，确认放弃并切换？",
                                                    )
                                                )
                                                    return;
                                                setPreviewValues(null);
                                                setConfirmedTimezone("");
                                                timezoneInput.current = undefined;
                                                setGroup(key);
                                                setSaved("");
                                                setDirty(false);
                                                setActionResult("");
                                            }}
                                        >
                                            {groupNames[key]}
                                        </button>
                                    ))}
                                </section>
                            ) : null;
                        })}
                        {categorySearch &&
                            !settingsCategories.some((category) =>
                                category.keys.some((key) =>
                                    (groupNames[key] + groupDescriptions[key])
                                        .toLowerCase()
                                        .includes(
                                            categorySearch.trim().toLowerCase(),
                                        ),
                                ),
                            ) && <p className="muted">没有匹配的设置分类</p>}
                    </nav>
                )}
                <section className="admin-settings-content">
                    {!section && (
                        <header className="admin-settings-heading">
                            <div>
                                <h3>{groupNames[group]}</h3>
                                <p className="muted">
                                    {groupDescriptions[group]}
                                </p>
                            </div>
                            {dirty && (
                                <span className="admin-unsaved">
                                    有未保存的修改
                                </span>
                            )}
                        </header>
                    )}
                    <State
                        data={loadedGroup.current === group ? true : undefined}
                        retryAt={Math.max(d.retryAt || 0, schema.retryAt || 0, plans.retryAt || 0, creditGroups.retryAt || 0)}
                        loading={
                            d.loading ||
                            schema.loading ||
                            plans.loading ||
                            creditGroups.loading
                        }
                        error={
                            d.error ||
                            schema.error ||
                            plans.error ||
                            creditGroups.error
                        }
                        retry={() => {
                            d.reload();
                            schema.reload();
                            plans.reload();
                            creditGroups.reload();
                        }}
                    >
                        {group === "entrypoints" && (
                            <AdminEntrypoints
                                key={JSON.stringify(raw.fastai_entrypoints)}
                                initial={raw.fastai_entrypoints || []}
                                publicKey={raw.fastai_entrypoint_public_key}
                                version={raw.fastai_entrypoints_version || 1}
                                save={async (entries) => {
                                    await request(admin("config/save"), {
                                        fastai_entrypoints: entries,
                                    });
                                    d.reload();
                                }}
                            />
                        )}
                        {group === "app" && (
                            <AdminFastaiDownloads
                                key={JSON.stringify(raw.fastai_releases)}
                                initial={raw.fastai_releases || []}
                                save={async (releases) => {
                                    await request(admin("config/save"), {
                                        fastai_releases: releases,
                                    });
                                }}
                            />
                        )}
                        {group === "email" && (
                            <div className="pad" role="note">
                                <strong>
                                    当前已保存的事务通道：
                                    {mailProviders[
                                        raw.email_provider || "smtp"
                                    ] || "未知"}
                                </strong>
                                <p className="muted">
                                    验证码、账单和服务提醒使用事务通道；必要服务群发使用事务通道。活动与推广可独立配置服务商与发件子域名，只发给主动订阅的用户。修改后保存并重启队列。星号表示凭据已设置，不代表已验证可用。
                                </p>
                            </div>
                        )}
                        {group !== "entrypoints" && (
                            <Editor
                                key={group + JSON.stringify(raw)}
                                fields={fields}
                                initial={raw}
                                onValuesChange={values => {
                                    const next = typeof values.system_timezone === "string" ? values.system_timezone : undefined;
                                    if (timezoneInput.current !== next) setConfirmedTimezone("");
                                    timezoneInput.current = next;
                                    setPreviewValues(values);
                                }}
                                preview={timezoneReview}
                                resolveFields={settingsFields}
                                linkValues={linkSettings}
                                onBusyChange={setSaving}
                                onDirtyChange={setDirty}
                                onDirty={() => {
                                    setSaved("");
                                    setActionResult("");
                                }}
                                validate={validateSettings}
                                onSave={async (body) => {
                                    const changes = changedSettings(body, raw);
                                    if (Object.prototype.hasOwnProperty.call(changes, "system_timezone") && String(changes.system_timezone) !== savedTimezone) {
                                        if (d.loading || d.error) throw new Error(tx("timeZoneChangeReload", { ns: "experience", defaultValue: "Reload the settings successfully before confirming a time zone change." }));
                                        if (confirmedTimezone !== timezoneChangeKey(changes.system_timezone)) throw new Error(tx("timeZoneChangeNeedsConfirm", { ns: "experience", defaultValue: "Review and confirm the time zone change before saving." }));
                                    }
                                    if (Object.keys(changes).length)
                                        await request(
                                            admin("config/save"),
                                            changes,
                                        );
                                    if (
                                        Object.prototype.hasOwnProperty.call(
                                            changes,
                                            "system_timezone",
                                        )
                                    ) {
                                        setTimeout(
                                            () => window.location.reload(),
                                            0,
                                        );
                                        return;
                                    }
                                    setSaved("设置已保存");
                                    setDirty(false);
                                    d.reload();
                                }}
                            />
                        )}
                        {group === "browser" && (
                            <AdminBrowserPreview
                                values={previewValues || raw}
                            />
                        )}
                        {group === "subscribe" && (
                            <p className="pad muted">
                                设置额度基础权限组后：订阅有效时，额度沿用订阅权限；订阅到期或无订阅时，额度仅可使用基础组节点。适用于所有额度用户（含已迁移的一次性套餐）。额度余额、套餐记录及限速、设备限制不变。节点在下次拉取用户时更新权限，客户端需更新订阅以刷新节点列表。
                            </p>
                        )}
                        {group === "app" && (
                            <div className="pad">
                                <p className="muted">
                                    填写 AppleAuto 的 HTTPS
                                    接口域名及分享链接最后一段代码。接口地址不包含
                                    /share 或 /client
                                    路径。仅有效订阅或有剩余额度的用户可查看。请先保存，再测试连接；启用后刷新用户页面。
                                </p>
                                <button
                                    disabled={dirty || actionBusy}
                                    onClick={() =>
                                        runAction("config/testAppleAccount")
                                    }
                                >
                                    测试下载账号连接
                                </button>
                            </div>
                        )}
                        {group === "email" && (
                            <div className="pad">
                                <p className="muted">
                                    测试邮件发往当前管理员邮箱，使用已保存的发送通道。修改邮件配置后需重启队列服务。发送成功仅代表服务商接受。
                                </p>
                                <button
                                    disabled={
                                        dirty ||
                                        actionBusy ||
                                        (raw.email_provider === "mailgun"
                                            ? !raw.email_mailgun_domain ||
                                              !raw.email_mailgun_key_configured
                                            : raw.email_provider === "resend"
                                              ? !raw.email_resend_key_configured
                                              : raw.email_provider === "ses"
                                                ? !raw.email_ses_region ||
                                                  (raw.email_ses_auth ===
                                                      "key" &&
                                                      !raw.email_ses_key_configured)
                                                : !raw.email_host) ||
                                        !raw.email_from_address
                                    }
                                    onClick={() =>
                                        runAction("config/testSendMail")
                                    }
                                >
                                    发送测试邮件
                                </button>
                                <p className="muted">
                                    {raw.email_provider === "ses" &&
                                    raw.email_ses_auth !== "key"
                                        ? "使用服务器 IAM 凭据，发送测试邮件可检查权限。"
                                        : raw.email_provider !== "smtp" && (
                                              <>
                                                  通道密钥：
                                                  {raw[
                                                      `email_${raw.email_provider}_key_configured`
                                                  ]
                                                      ? "已配置（留空保留）"
                                                      : "未配置"}{" "}
                                                  ·{" "}
                                              </>
                                          )}
                                    <a href="#/mail-logs">查看邮件日志</a>
                                </p>
                                <button
                                    disabled={
                                        dirty ||
                                        actionBusy ||
                                        !raw.email_announcement_separate
                                    }
                                    onClick={() =>
                                        runAction("config/testSendMail", {
                                            stream: "announcement",
                                        })
                                    }
                                >
                                    测试推广通道（发往管理员）
                                </button>
                                <details>
                                    <summary>投递回调配置</summary>
                                    <p className="muted">
                                        在服务商订阅 delivered / bounce /
                                        complaint 事件。SMTP
                                        本身没有通用异步回调。两个通道若使用不同账号，需将回调统一到同一可信账号或主题；目前每个服务商配置一组回调凭据。
                                    </p>
                                    {["mailgun", "resend", "ses"].map(
                                        (provider) => (
                                            <p key={provider}>
                                                {mailProviders[provider]}：
                                                <code>
                                                    {String(
                                                        raw.email_public_url ||
                                                            "https://你的API域名",
                                                    ).replace(/\/$/, "")}
                                                    /api/v10/webhooks/mail/
                                                    {provider}
                                                </code>
                                            </p>
                                        ),
                                    )}
                                </details>
                                <AdminMailPreview />
                            </div>
                        )}
                        {group === "telegram" && (
                            <div className="pad">
                                <p className="muted">
                                    使用已保存的机器人 Token 在 Telegram
                                    注册本站 Webhook；站点需有可访问的 HTTPS
                                    地址。
                                </p>
                                <button
                                    disabled={
                                        dirty ||
                                        actionBusy ||
                                        !raw.telegram_bot_token
                                    }
                                    onClick={() =>
                                        runAction("config/setTelegramWebhook")
                                    }
                                >
                                    设置 Telegram Webhook
                                </button>
                                <AdminTelegramCommunity
                                    disabled={dirty || actionBusy}
                                />
                            </div>
                        )}
                        {dirty && ["email", "telegram"].includes(group) && (
                            <p className="pad muted">
                                请先保存配置，再执行测试或连接操作。
                            </p>
                        )}
                        {actionResult && (
                            <p className="pad" role="status">
                                {actionResult}
                            </p>
                        )}
                        {saved && (
                            <p className="success-message" role="status">
                                {saved}
                            </p>
                        )}
                    </State>
                </section>
            </div>
        </Panel>
    );
}
