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
import { AdminOperationNotice } from "./admin-section";
import type { OperationNotice } from "./admin-operation";

type SettingsAction = "transactional" | "announcement" | "apple" | "telegram";
function mailTestRequirement(saved: Row, stream: "transactional" | "announcement") {
    if (stream === "announcement" && !saved.email_announcement_separate)
        return "请先启用并保存推广独立通道。";
    const prefix = stream === "announcement" ? "email_announcement_" : "email_";
    const read = (field: string) => saved[prefix + field];
    if (!read("from_address")) return "请先填写并保存发件地址。";
    switch (read("provider") || "smtp") {
        case "mailgun":
            if (!read("mailgun_domain") || !read("mailgun_key_configured"))
                return "请先保存 Mailgun 发件域名和 API 密钥。";
            break;
        case "resend":
            if (!read("resend_key_configured")) return "请先保存 Resend API 密钥。";
            break;
        case "ses":
            if (!read("ses_region") || (read("ses_auth") === "key" && !read("ses_key_configured")))
                return "请先保存 SES 区域和所选鉴权方式需要的凭据。";
            break;
        default:
            if (!read("host")) return "请先填写并保存 SMTP 服务器地址。";
    }
    return "";
}
const sectionTitles: Record<string, string> = {
    site: "基础信息",
    footer: "页脚 HTML",
    safe: "账户与注册",
    browser: "浏览器引导",
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
export function Settings({ section: group }: { section: string }) {
    const d = useData(admin("config/fetch"));
    const schema = useData(admin("console/configSchema"));
    const [saved, setSaved] = useState("");
    const plans = useData<Row[]>(group === "site" ? admin("plan/fetch") : "");
    const creditGroups = useData<Row[]>(group === "subscribe" ? admin("server/group/fetch") : "");
    const [saving, setSaving] = useState(false);
    const [dirty, setDirty] = useState(false);
    const [activeAction, setActiveAction] = useState<SettingsAction | null>(null);
    const [actionResults, setActionResults] = useState<Partial<Record<SettingsAction, OperationNotice>>>({});
    const actionBusy = activeAction !== null;
    const actionPending = useRef(false);
    async function runAction(
        action: SettingsAction,
        endpoint: string,
        body: Record<string, unknown> = {},
    ) {
        if (actionPending.current) return;
        actionPending.current = true;
        setActiveAction(action);
        setActionResults(previous => ({ ...previous, [action]: undefined }));
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
            setActionResults(previous => ({ ...previous, [action]: {
                kind: "success",
                message: endpoint === "config/testSendMail"
                    ? "邮件已被发送服务接受，请检查收件箱；最终投递结果需核查服务商记录。"
                    : "操作成功",
            } }));
        } catch (e) {
            setActionResults(previous => ({ ...previous, [action]: { kind: "error", message: (e as Error).message } }));
        } finally {
            actionPending.current = false;
            setActiveAction(null);
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
        Object.entries(source).filter(
            ([key]) => !key.startsWith("commission_distribution_") &&
                (group === "browser"
                    ? key.startsWith("browser_policy_")
                    : group !== "safe" || !key.startsWith("browser_policy_")),
        ),
    );
    const mailTestReady = !dirty && !saving && !d.loading && !d.error && !actionBusy;
    const mailTestReason = group === "email" ? mailTestRequirement(raw, "transactional") : "";
    const promotionTestReason = group === "email" ? mailTestRequirement(raw, "announcement") : "";
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
                    k !== "fastai_releases_revision" &&
                    k !== "fastai_release_min_version" &&
                    k !== "fastai_release_targets" &&
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
            title={sectionTitles[group]}
            className="settings-panel"
        >
            <div data-saving={saving || actionBusy ? "true" : undefined}>
                <section className="admin-settings-content">
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
                                initial={raw.fastai_releases || []}
                                initialRevision={raw.fastai_releases_revision}
                                globalMinimum={raw.fastai_release_min_version}
                                targets={raw.fastai_release_targets}
                                save={async (releases, revision) => {
                                    if (typeof revision !== "string" || !revision) {
                                        throw Object.assign(new Error("发布目录修订号不可用"), { status: 409 });
                                    }
                                    await request(admin("config/save"), {
                                        fastai_releases: releases,
                                        fastai_releases_revision: revision,
                                    });
                                }}
                                reload={async () => {
                                    const { data } = await request(admin("config/fetch"));
                                    const app = data?.app;
                                    if (!Array.isArray(app?.fastai_releases) || typeof app.fastai_releases_revision !== "string") {
                                        throw new Error("无法读取发布目录与修订号");
                                    }
                                    return {
                                        releases: app.fastai_releases,
                                        revision: app.fastai_releases_revision,
                                        globalMinimum: app.fastai_release_min_version,
                                    };
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
                                    setActionResults({});
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
                                        runAction("apple", "config/testAppleAccount")
                                    }
                                >
                                    测试下载账号连接
                                </button>
                                <AdminOperationNotice notice={actionResults.apple ?? null} />
                            </div>
                        )}
                        {group === "email" && (
                            <div className="pad">
                                <h3>测试邮件通道</h3>
                                <p className="muted">
                                    测试邮件发往当前管理员邮箱，使用已保存的发送通道。修改邮件配置后需重启队列服务。发送成功仅代表服务商接受。
                                </p>
                                {dirty && <p className="muted">请先保存配置，再执行测试或连接操作。</p>}
                                <h4>事务通道</h4>
                                <button
                                    disabled={!mailTestReady || !!mailTestReason}
                                    onClick={() =>
                                        runAction("transactional", "config/testSendMail")
                                    }
                                >
                                    {activeAction === "transactional" ? "发送测试邮件中…" : "发送测试邮件"}
                                </button>
                                {mailTestReason && <p className="muted">{mailTestReason}</p>}
                                <AdminOperationNotice notice={actionResults.transactional ?? null} />
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
                                <h4>推广通道</h4>
                                <button
                                    disabled={!mailTestReady || !!promotionTestReason}
                                    onClick={() =>
                                        runAction("announcement", "config/testSendMail", {
                                            stream: "announcement",
                                        })
                                    }
                                >
                                    {activeAction === "announcement" ? "测试推广通道中…" : "测试推广通道（发往管理员）"}
                                </button>
                                {promotionTestReason && <p className="muted">{promotionTestReason}</p>}
                                <AdminOperationNotice notice={actionResults.announcement ?? null} />
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
                                        runAction("telegram", "config/setTelegramWebhook")
                                    }
                                >
                                    设置 Telegram Webhook
                                </button>
                                <AdminOperationNotice notice={actionResults.telegram ?? null} />
                                <AdminTelegramCommunity
                                    disabled={dirty || actionBusy}
                                />
                            </div>
                        )}
                        {dirty && group === "telegram" && (
                            <p className="pad muted">
                                请先保存配置，再执行测试或连接操作。
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
